"""TRELLIS v1 (microsoft/TRELLIS-image-large) image-to-3D on Modal, for the model comparison.

No gated models: DINOv2 comes from torch.hub (Apache 2.0), background removal is rembg u2net.
    modal run trellis1_modal.py::check_imports           # CPU: build the image, prove imports
    modal run trellis1_modal.py::download                # CPU: cache weights in the volume
    modal run trellis1_modal.py --images a.png,b.png     # GPU: one container, all images, GLBs to demo/trellis1/
Same credit guards as trellis_modal.py. Test entrypoint only; the comparison winner gets the web endpoint.
"""

from __future__ import annotations  # lets the web endpoint name fastapi.Request, which only its own image installs

import os

import modal

TRELLIS_COMMIT = "193e0502b5cb3eb5997ec457d5340e95d09b158e"  # microsoft/TRELLIS main on 2026-11-16
VOL = "/vol"

app = modal.App("trellis1-3d")
vol = modal.Volume.from_name("trellis-weights", create_if_missing=True)

# Versions follow microsoft/TRELLIS setup.sh for torch 2.4.0 + CUDA 12.1 (xformers 0.0.27.post2,
# spconv-cu120, kaolin from NVIDIA's wheel index). numpy < 2 for spconv and torch 2.4.
image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.10")
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0", "libjpeg-dev",
                 "libxrender1", "libx11-6", "libxext6", "libsm6")  # vtk (pyvista) needs X libs to import
    .pip_install("torch==2.4.0", "torchvision==0.19.0", index_url="https://download.pytorch.org/whl/cu121")
    .pip_install("xformers==0.0.27.post2", index_url="https://download.pytorch.org/whl/cu121")
    .pip_install("kaolin==0.17.0", find_links="https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.4.0_cu121.html")
    .pip_install(
        "ninja", "wheel", "setuptools", "numpy==1.26.4", "spconv-cu120", "pillow", "imageio",
        "imageio-ffmpeg", "tqdm", "easydict", "opencv-python-headless==4.10.0.84", "scipy",
        "rembg==2.0.65", "onnxruntime==1.20.1", "trimesh", "xatlas", "pyvista", "pymeshfix", "igraph",
        "transformers==4.46.3", "plyfile", "matplotlib",
        "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8",
    )
    # Modal's bundled Python asks for clang++; this image has gcc. No GPU at build time, so name the archs.
    .env({"TORCH_CUDA_ARCH_LIST": "8.0;8.6;8.9;9.0", "MAX_JOBS": "8", "CC": "gcc", "CXX": "g++"})
    .run_commands(
        "git clone -b v0.3.3 https://github.com/NVlabs/nvdiffrast.git /ext/nvdiffrast"
        " && pip install /ext/nvdiffrast --no-build-isolation",
        "git clone https://github.com/autonomousvision/mip-splatting.git /ext/mip-splatting && cd /ext/mip-splatting"
        " && git checkout dda02ab5ecf4 && git submodule update --init --recursive"
        " && pip install submodules/diff-gaussian-rasterization --no-build-isolation",
        f"git clone https://github.com/microsoft/TRELLIS.git /trellis && cd /trellis"
        f" && git checkout {TRELLIS_COMMIT} && git submodule update --init --recursive",
    )
    .pip_install("open3d==0.18.0")  # imported by trellis/pipelines/__init__ via the text pipeline
    .env({
        "PYTHONPATH": "/trellis",
        "HF_HOME": f"{VOL}/hf",
        "TORCH_HOME": f"{VOL}/torch",   # DINOv2 via torch.hub
        "U2NET_HOME": f"{VOL}/u2net",   # rembg background model
        "ATTN_BACKEND": "xformers",
        "SPCONV_ALGO": "native",        # 'auto' benchmarks first, on GPU time
    })
)


@app.function(image=image, timeout=600)
def check_imports():
    import subprocess
    import torch, xformers, spconv, kaolin, nvdiffrast.torch, diff_gaussian_rasterization  # noqa: E401,F401
    from trellis.pipelines import TrellisImageTo3DPipeline  # noqa: F401
    from trellis.utils import postprocessing_utils  # noqa: F401
    print("imports ok: torch", torch.__version__, "xformers", xformers.__version__)
    print(subprocess.run(["pip", "freeze"], capture_output=True, text=True).stdout)


@app.function(image=image, volumes={VOL: vol}, timeout=3600, memory=8192)
def download():
    import rembg, torch
    from huggingface_hub import snapshot_download
    try:
        snapshot_download("microsoft/TRELLIS-image-large")
        torch.hub.load("facebookresearch/dinov2", "dinov2_vitl14_reg", pretrained=True)
        rembg.new_session("u2net")
        print("all weights cached")
    finally:
        vol.commit()


@app.cls(image=image, gpu="L40S", volumes={VOL: vol}, timeout=600, scaledown_window=60, max_containers=1)
class Trellis1:
    @modal.enter()
    def load(self):
        import time
        from trellis.pipelines import TrellisImageTo3DPipeline
        t = time.time()
        self.pipe = TrellisImageTo3DPipeline.from_pretrained("microsoft/TRELLIS-image-large")
        self.pipe.cuda()
        print(f"model loaded in {time.time() - t:.0f}s")

    @modal.method()
    def generate(self, image_bytes: bytes, seed: int = 42) -> bytes:
        import io, tempfile, time  # noqa: E401
        import torch
        from PIL import Image
        from trellis.utils import postprocessing_utils

        t = time.time()
        torch.cuda.reset_peak_memory_stats()
        out = self.pipe.run(Image.open(io.BytesIO(image_bytes)), seed=seed, formats=["gaussian", "mesh"])
        # official example.py export settings
        glb = postprocessing_utils.to_glb(out["gaussian"][0], out["mesh"][0], simplify=0.95, texture_size=1024)
        with tempfile.NamedTemporaryFile(suffix=".glb") as f:
            glb.export(f.name)
            data = open(f.name, "rb").read()
        print(f"generated in {time.time() - t:.0f}s, peak VRAM "
              f"{torch.cuda.max_memory_allocated() / 2**30:.1f} GiB, GLB {len(data) / 2**20:.1f} MiB")
        torch.cuda.empty_cache()
        return data


# --- Text to 3D: TRELLIS-text-xlarge, the model NVIDIA's hosted trellis runs, on our own GPU ---
secret = modal.Secret.from_name("trellis-3d")  # API_KEY, shared with trellis_modal.py
MAX_PROMPT = 1000


@app.function(image=image, volumes={VOL: vol}, timeout=3600)
def download_text():
    from huggingface_hub import snapshot_download
    try:
        snapshot_download("microsoft/TRELLIS-text-xlarge")
        # its pipeline.json takes the decoders from this repo, not microsoft/TRELLIS-image-large
        snapshot_download("JeffreyXiang/TRELLIS-image-large", allow_patterns=["ckpts/ss_dec_*", "ckpts/slat_dec_*"])
        snapshot_download("openai/clip-vit-large-patch14", allow_patterns=["*.json", "*.txt", "model.safetensors"])
        print("text weights cached")
    finally:
        vol.commit()


@app.cls(image=image, gpu="L40S", volumes={VOL: vol}, timeout=600, scaledown_window=60, max_containers=1)
class Trellis1Text:
    @modal.enter()
    def load(self):
        import time
        os.environ["HF_HUB_OFFLINE"] = "1"  # everything is cached; fail fast instead of downloading on GPU time
        from trellis.pipelines import TrellisTextTo3DPipeline
        t = time.time()
        self.pipe = TrellisTextTo3DPipeline.from_pretrained("microsoft/TRELLIS-text-xlarge")
        self.pipe.cuda()
        print(f"text model loaded in {time.time() - t:.0f}s")

    @modal.method()
    def generate(self, prompt: str, seed: int = 42) -> bytes:
        import tempfile, time  # noqa: E401
        import torch
        from trellis.utils import postprocessing_utils

        t = time.time()
        torch.cuda.reset_peak_memory_stats()
        out = self.pipe.run(prompt, seed=seed, formats=["gaussian", "mesh"])
        glb = postprocessing_utils.to_glb(out["gaussian"][0], out["mesh"][0], simplify=0.95, texture_size=1024)
        with tempfile.NamedTemporaryFile(suffix=".glb") as f:
            glb.export(f.name)
            data = open(f.name, "rb").read()
        print(f"generated in {time.time() - t:.0f}s, peak VRAM "
              f"{torch.cuda.max_memory_allocated() / 2**30:.1f} GiB, GLB {len(data) / 2**20:.1f} MiB")
        torch.cuda.empty_cache()
        return data


web_image = modal.Image.debian_slim().pip_install("fastapi[standard]")
with web_image.imports():
    from fastapi import Request


@app.function(image=web_image, secrets=[secret], timeout=600)
@modal.fastapi_endpoint(method="POST")
async def generate_text(request: Request):
    """POST the prompt as plain text with `Authorization: Bearer <API_KEY>`; returns a GLB."""
    import hmac
    from fastapi import HTTPException
    from fastapi.responses import Response

    sent = request.headers.get("authorization", "")
    if not hmac.compare_digest(sent.encode(), f"Bearer {os.environ['API_KEY']}".encode()):
        raise HTTPException(401, "Invalid API key")  # checked on CPU, so a bad request never starts the GPU
    prompt = (await request.body()).decode("utf-8", "replace").strip()
    if not prompt or len(prompt) > MAX_PROMPT:
        raise HTTPException(400, f"Send a prompt of 1 to {MAX_PROMPT} characters")
    glb = await Trellis1Text().generate.remote.aio(prompt)
    return Response(glb, media_type="model/gltf-binary")


@app.local_entrypoint()
def text(prompt: str, out: str = "demo/trellis1/text.glb"):
    """GPU test of the text model: modal run trellis1_modal.py::text --prompt '...'"""
    import time
    t = time.time()
    data = Trellis1Text().generate.remote(prompt)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "wb").write(data)
    print(f"saved {out} ({len(data) / 2**20:.1f} MiB) in {time.time() - t:.0f}s round trip")


@app.local_entrypoint()
def main(images: str, out_dir: str = "demo/trellis1"):
    import time
    os.makedirs(out_dir, exist_ok=True)
    model = Trellis1()
    for path in images.split(","):
        t = time.time()
        data = model.generate.remote(open(path, "rb").read())
        out = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".glb")
        open(out, "wb").write(data)
        print(f"saved {out} ({len(data) / 2**20:.1f} MiB) in {time.time() - t:.0f}s round trip")
