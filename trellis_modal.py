"""TRELLIS.2 image-to-3D on Modal, behind an API key.

One-off setup (CPU only, cheap):
    modal run trellis_modal.py::check_imports   # builds the image, proves the GPU libraries import
    modal run trellis_modal.py::download        # caches all model weights in the trellis-weights volume
Test on the GPU (one container, model loads once, GLBs to demo/trellis2/):
    modal run trellis_modal.py --images a.png,b.png
Deploy the endpoint:
    modal deploy trellis_modal.py

Credit guards: one GPU container at most, it shuts down after 60 s idle, every job is
capped at 10 min, and a CPU function checks the API key before the GPU is ever started.
"""

from __future__ import annotations

import os

import modal

TRELLIS_COMMIT = "75fbf0183001ed9876c8dbb35de6b68552ee08bd"  # microsoft/TRELLIS.2 main on 2026-11-16
VOL = "/vol"
MODEL_DIR = f"{VOL}/TRELLIS.2-4B"
MAX_UPLOAD = 10 * 1024 * 1024  # same 10 MB limit as the web form

app = modal.App("trellis-3d")
vol = modal.Volume.from_name("trellis-weights", create_if_missing=True)
secret = modal.Secret.from_name("trellis-3d")  # API_KEY (endpoint), HF_TOKEN (download only)

# Versions follow microsoft/TRELLIS.2 setup.sh (torch 2.6 + CUDA 12.4); other pins follow the
# official Space's requirements.txt. GPU code is compiled on CPU for A100, A10G, L40S and H100.
image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.10")
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0", "libjpeg-dev")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", index_url="https://download.pytorch.org/whl/cu124")
    .pip_install(
        "ninja", "wheel", "setuptools", "pillow==12.0.0", "imageio==2.37.2", "imageio-ffmpeg==0.6.0", "tqdm==4.67.1",
        "easydict==1.13", "opencv-python-headless==4.12.0.88", "trimesh==4.10.1",
        "transformers==4.57.3", "zstandard==0.25.0", "kornia==0.8.2", "timm==1.0.22", "einops",
        "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8",
        # official prebuilt wheel; a direct URL so pip can never fall back to an hours-long source build
        "https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.3/"
        "flash_attn-2.7.3+cu12torch2.6cxx11abiFALSE-cp310-cp310-linux_x86_64.whl",
    )
    # Modal's bundled Python was built with clang and asks extensions for clang++; this image has gcc.
    .env({"TORCH_CUDA_ARCH_LIST": "8.0;8.6;8.9;9.0", "MAX_JOBS": "8", "CC": "gcc", "CXX": "g++"})
    .run_commands(
        "git clone -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git /ext/nvdiffrast"
        " && pip install /ext/nvdiffrast --no-build-isolation",
        "git clone https://github.com/JeffreyXiang/nvdiffrec.git /ext/nvdiffrec && cd /ext/nvdiffrec"
        " && git checkout b296927cc7fd && pip install . --no-build-isolation",
        "git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /ext/CuMesh && cd /ext/CuMesh"
        " && git checkout 12289e1062f0 && git submodule update --init --recursive && pip install . --no-build-isolation",
        "git clone --recursive https://github.com/JeffreyXiang/FlexGEMM.git /ext/FlexGEMM && cd /ext/FlexGEMM"
        " && git checkout 6dd94a859c26 && git submodule update --init --recursive && pip install . --no-build-isolation",
        f"git clone --recursive https://github.com/microsoft/TRELLIS.2.git /trellis2 && cd /trellis2"
        f" && git checkout {TRELLIS_COMMIT} && git submodule update --init --recursive"
        " && pip install ./o-voxel --no-build-isolation",
    )
    .env({
        "PYTHONPATH": "/trellis2",
        "HF_HOME": f"{VOL}/hf",
        "ATTN_BACKEND": "flash_attn",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        "OPENCV_IO_ENABLE_OPENEXR": "1",
    })
)


@app.function(image=image, timeout=600)
def check_imports():
    # flex_gemm (and so o_voxel and trellis2) starts Triton's GPU driver on import, so those can
    # only be checked on a GPU; the first GPU test covers them.
    import torch, flash_attn, nvdiffrast.torch, cumesh  # noqa: E401,F401
    print("imports ok: torch", torch.__version__, "flash_attn", flash_attn.__version__)


@app.function(image=image, volumes={VOL: vol}, secrets=[secret], timeout=3600)
def download():
    import json
    from huggingface_hub import snapshot_download

    token = os.environ["HF_TOKEN"]
    try:
        snapshot_download("microsoft/TRELLIS.2-4B", local_dir=MODEL_DIR, token=token)
        # Background removal: RMBG-2.0 is gated and non-commercial; BiRefNet is the same
        # architecture, ungated, MIT, and the code's own default.
        path = f"{MODEL_DIR}/pipeline.json"
        cfg = json.load(open(path))
        cfg["args"]["rembg_model"]["args"]["model_name"] = "ZhengPeng7/BiRefNet"
        json.dump(cfg, open(path, "w"), indent=4)
        snapshot_download("microsoft/TRELLIS-image-large", allow_patterns=["ckpts/ss_dec_conv3d_16l8_fp16*"], token=token)
        snapshot_download("ZhengPeng7/BiRefNet", token=token)
        snapshot_download("facebook/dinov3-vitl16-pretrain-lvd1689m", token=token)  # gated: needs Meta's approval
        print("all weights cached")
    finally:
        vol.commit()


@app.cls(image=image, gpu="L40S", volumes={VOL: vol}, timeout=600, scaledown_window=60, max_containers=1)
class Trellis:
    @modal.enter()
    def load(self):
        import time
        os.environ["HF_HUB_OFFLINE"] = "1"  # everything is cached; fail fast instead of downloading on GPU time
        from trellis2.pipelines import Trellis2ImageTo3DPipeline

        t = time.time()
        self.pipe = Trellis2ImageTo3DPipeline.from_pretrained(MODEL_DIR)
        self.pipe.low_vram = False
        self.pipe.cuda()
        print(f"model loaded in {time.time() - t:.0f}s")

    @modal.method()
    def generate(self, image_bytes: bytes, seed: int = 42, pipeline_type: str = "1024_cascade",
                 decimation_target: int = 300000, texture_size: int = 2048) -> bytes:
        # Defaults are what the app has used since day one. Microsoft's example.py exports at
        # 1,000,000 faces and 4096 px; pipeline_type '1536_cascade' is TRELLIS.2's finest geometry.
        import io, tempfile, time  # noqa: E401
        import o_voxel, torch  # noqa: E401
        from PIL import Image

        t = time.time()
        torch.cuda.reset_peak_memory_stats()
        mesh = self.pipe.run(Image.open(io.BytesIO(image_bytes)), seed=seed, pipeline_type=pipeline_type)[0]
        mesh.simplify(16777216)  # nvdiffrast limit
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
            attr_layout=mesh.layout, voxel_size=mesh.voxel_size, aabb=[[-0.5] * 3, [0.5] * 3],
            decimation_target=decimation_target, texture_size=texture_size,
            remesh=True, remesh_band=1, remesh_project=0,
        )
        with tempfile.NamedTemporaryFile(suffix=".glb") as f:
            glb.export(f.name, extension_webp=True)
            data = open(f.name, "rb").read()
        print(f"{pipeline_type}, {decimation_target} faces, {texture_size} px: generated in {time.time() - t:.0f}s, peak VRAM "
              f"{torch.cuda.max_memory_allocated() / 2**30:.1f} GiB, GLB {len(data) / 2**20:.1f} MiB")
        torch.cuda.empty_cache()
        return data


# Draft: what the app has always used (chair 48 s, 10 MB). High: Microsoft's example.py export at the
# finest geometry pass (chair 161 s, 36 MB, 26 to 30 GiB peak on the L40S). Measured 16 Nov 2026.
QUALITY = {
    "draft": dict(pipeline_type="1024_cascade", decimation_target=300000, texture_size=2048),
    "high": dict(pipeline_type="1536_cascade", decimation_target=1000000, texture_size=4096),
}

web_image = modal.Image.debian_slim().pip_install("fastapi[standard]")
with web_image.imports():
    from fastapi import Request


# 900 s: this wait includes the GPU cold start, and a cold High run can reach 9 minutes in total.
@app.function(image=web_image, secrets=[secret], timeout=900)
@modal.fastapi_endpoint(method="POST")
async def generate(request: Request):
    """POST raw image bytes with `Authorization: Bearer <API_KEY>`; returns a GLB."""
    import hmac
    from fastapi import HTTPException
    from fastapi.responses import Response

    sent = request.headers.get("authorization", "")
    if not hmac.compare_digest(sent.encode(), f"Bearer {os.environ['API_KEY']}".encode()):
        raise HTTPException(401, "Invalid API key")  # checked on CPU, so a bad request never starts the GPU
    body = await request.body()
    if not body or len(body) > MAX_UPLOAD:
        raise HTTPException(400, "Send one image of at most 10 MB")
    # ?quality=high asks for TRELLIS.2's finest pass; anything else is draft (the original settings).
    settings = QUALITY.get(request.query_params.get("quality", ""), QUALITY["draft"])
    glb = await Trellis().generate.remote.aio(body, **settings)
    return Response(glb, media_type="model/gltf-binary")


@app.local_entrypoint()
def main(images: str, out_dir: str = "demo/trellis2", pipeline_type: str = "1024_cascade",
         decimation_target: int = 300000, texture_size: int = 2048):
    """Comma-separated image paths; all run in one warm container, so the model loads once."""
    import time
    os.makedirs(out_dir, exist_ok=True)
    model = Trellis()
    for path in images.split(","):
        t = time.time()
        data = model.generate.remote(open(path, "rb").read(), pipeline_type=pipeline_type,
                                     decimation_target=decimation_target, texture_size=texture_size)
        out = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".glb")
        open(out, "wb").write(data)
        print(f"saved {out} ({len(data) / 2**20:.1f} MiB) in {time.time() - t:.0f}s round trip")
