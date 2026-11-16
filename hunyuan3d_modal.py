"""Hunyuan3D-2.1 (Tencent) image-to-3D with PBR texture on Modal, for the model comparison.

Ungated. Two stages: shape (DiT flow model, about 10 GB VRAM), then paint (multiview PBR, about 21 GB).
    modal run hunyuan3d_modal.py::check_imports          # CPU: build the image, prove imports
    modal run hunyuan3d_modal.py::download               # CPU: cache weights in the volume
    modal run hunyuan3d_modal.py --images a.png,b.png    # GPU: one container, all images, GLBs to demo/hunyuan3d/
Same credit guards as trellis_modal.py. Test entrypoint only.
"""

import os

import modal

HY_COMMIT = "82920d643c0dc2f7bfd7255f45f62d386edfe60c"  # Tencent-Hunyuan/Hunyuan3D-2.1 main on 2026-11-16
VOL = "/vol"
REPO = "/hy21"

app = modal.App("hunyuan3d-21")
vol = modal.Volume.from_name("trellis-weights", create_if_missing=True)

# Versions from the repo's requirements.txt (Python 3.10, torch 2.5.1 + CUDA 12.4), PyPI only: its
# Tencent and Aliyun mirror indexes are dropped. Only packages inference imports are installed.
image = (
    # Python 3.11, not the repo's 3.10: PyPI no longer has bpy 4.0 or any bpy wheel for 3.10, and the
    # repo's mesh_utils.py already handles Blender 4.2+ (shade_auto_smooth).
    modal.Image.from_registry("nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "wget", "build-essential", "libgl1", "libglib2.0-0", "libsm6", "libxrender1",
                 "libxext6", "libxi6", "libxxf86vm1", "libxfixes3", "libxkbcommon0")  # bpy (Blender) needs X libs
    .pip_install("torch==2.5.1", "torchvision==0.20.1", index_url="https://download.pytorch.org/whl/cu124")
    .pip_install(
        "ninja==1.11.1.1", "pybind11==2.13.4", "wheel", "setuptools",
        "transformers==4.46.0", "diffusers==0.30.0", "accelerate==1.1.1", "pytorch-lightning==1.9.5",
        "huggingface-hub==0.30.2", "safetensors==0.4.4", "numpy==1.24.4", "scipy==1.14.1", "einops==0.8.0",
        "opencv-python==4.10.0.84", "imageio==2.36.0", "scikit-image==0.24.0", "rembg==2.0.65",
        "onnxruntime==1.16.3", "trimesh==4.4.7", "pymeshlab==2022.2.post3", "pygltflib==1.16.3",
        "xatlas==0.0.9", "omegaconf==2.3.0", "pyyaml==6.0.2", "tqdm==4.66.5", "bpy==4.2.23", "timm",
        "torchdiffeq", "pythreejs",
    )
    # basicsr's setup.py imports torch, so it must build against the installed one
    .pip_install("basicsr==1.4.2", "realesrgan==0.3.0", extra_options="--no-build-isolation")
    # Modal's bundled Python asks for clang++; this image has gcc. No GPU at build time, so name the archs.
    .env({"TORCH_CUDA_ARCH_LIST": "8.0;8.6;8.9;9.0", "MAX_JOBS": "8", "CC": "gcc", "CXX": "g++"})
    .run_commands(
        f"git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git {REPO} && cd {REPO} && git checkout {HY_COMMIT}",
        f"cd {REPO}/hy3dpaint/custom_rasterizer && pip install . --no-build-isolation",
        f"cd {REPO}/hy3dpaint/DifferentiableRenderer && c++ -O3 -Wall -shared -std=c++11 -fPIC"
        " $(python -m pybind11 --includes) mesh_inpaint_processor.cpp -o mesh_inpaint_processor"
        "$(python -c 'import sysconfig; print(sysconfig.get_config_var(\"EXT_SUFFIX\"))')",
        f"wget -q https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth -P {REPO}/hy3dpaint/ckpt",
    )
    # in the repo's requirements; trimesh's simplify_quadric_decimation (paint stage remesh) needs it
    .pip_install("open3d==0.18.0", "pandas==2.2.2")  # pandas: the repo pin; open3d would pull pandas 3.x, which needs numpy 2
    # a later install pulls in numpy 2.x, which breaks onnxruntime 1.16 (rembg); force numpy 1.x back as the last layer
    .pip_install("numpy==1.26.4")  # still numpy 1.x; matplotlib (pulled in later) needs >= 1.25
    .workdir(REPO)
    .env({
        "PYTHONPATH": f"{REPO}:{REPO}/hy3dshape:{REPO}/hy3dpaint",
        "HF_HOME": f"{VOL}/hf",
        "HY3DGEN_MODELS": f"{VOL}/hy3dgen",  # shape model's own cache folder
        "U2NET_HOME": f"{VOL}/u2net",
    })
)


@app.function(image=image, timeout=600)
def check_imports():
    import subprocess
    import torch, bpy, custom_rasterizer  # noqa: E401,F401
    from torchvision_fix import apply_fix
    apply_fix()  # basicsr expects a torchvision module that newer versions removed
    # same imports as Hunyuan3D.load, so a broken import fails here on CPU, not on GPU time
    from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline  # noqa: F401
    from hy3dshape.rembg import BackgroundRemover  # noqa: F401
    from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline  # noqa: F401
    import numpy
    print("imports ok: torch", torch.__version__, "bpy", bpy.app.version_string, "numpy", numpy.__version__)
    print(subprocess.run(["pip", "check"], capture_output=True, text=True).stdout)

    # The paint stage's CPU-only steps on a test sphere: remesh (pymeshlab + trimesh/open3d),
    # UV unwrap (xatlas), and OBJ to GLB in Blender, which returns False instead of raising.
    import tempfile, trimesh  # noqa: E401
    from utils.simplify_mesh_utils import remesh_mesh
    from utils.uvwrap_utils import mesh_uv_wrap
    from DifferentiableRenderer.mesh_utils import convert_obj_to_glb
    with tempfile.TemporaryDirectory() as d:
        trimesh.creation.icosphere(subdivisions=6).export(f"{d}/shape.glb")  # 81,920 faces, above the 40,000 target
        remesh_mesh(f"{d}/shape.glb", f"{d}/remesh.obj")
        mesh = mesh_uv_wrap(trimesh.load(f"{d}/remesh.obj"))
        mesh.export(f"{d}/uv.obj")
        assert convert_obj_to_glb(f"{d}/uv.obj", f"{d}/out.glb"), "Blender OBJ to GLB failed"
        print("paint post-processing ok:", len(mesh.faces), "faces,", os.path.getsize(f"{d}/out.glb"), "byte GLB")


@app.function(image=image, volumes={VOL: vol}, timeout=3600)
def download():
    import rembg
    from huggingface_hub import snapshot_download
    try:
        snapshot_download("tencent/Hunyuan3D-2.1", allow_patterns=["hunyuan3d-dit-v2-1/*", "hunyuan3d-vae-v2-1/*"],
                          local_dir=f"{VOL}/hy3dgen/tencent/Hunyuan3D-2.1")
        snapshot_download("tencent/Hunyuan3D-2.1", allow_patterns=["hunyuan3d-paintpbr-v2-1/*"])
        snapshot_download("facebook/dinov2-giant")
        rembg.new_session()  # default u2net
        print("all weights cached")
    finally:
        vol.commit()


@app.cls(image=image, gpu="L40S", volumes={VOL: vol}, timeout=900, scaledown_window=60, max_containers=1)
class Hunyuan3D:
    @modal.enter()
    def load(self):
        import time
        os.environ["HF_HUB_OFFLINE"] = "1"  # everything is cached; fail fast instead of downloading on GPU time
        from torchvision_fix import apply_fix
        apply_fix()
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
        from hy3dshape.rembg import BackgroundRemover
        from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline

        t = time.time()
        self.shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained("tencent/Hunyuan3D-2.1")
        conf = Hunyuan3DPaintConfig(6, 512)  # demo.py defaults: 6 views, 512 px
        conf.realesrgan_ckpt_path = f"{REPO}/hy3dpaint/ckpt/RealESRGAN_x4plus.pth"
        conf.multiview_cfg_path = f"{REPO}/hy3dpaint/cfgs/hunyuan-paint-pbr.yaml"
        conf.custom_pipeline = f"{REPO}/hy3dpaint/hunyuanpaintpbr"
        self.paint = Hunyuan3DPaintPipeline(conf)
        self.rembg = BackgroundRemover()
        print(f"model loaded in {time.time() - t:.0f}s")

    @modal.method()
    def generate(self, image_bytes: bytes, seed: int = 42) -> bytes:
        import io, tempfile, time  # noqa: E401
        import torch
        from PIL import Image

        t = time.time()
        torch.cuda.reset_peak_memory_stats()
        torch.manual_seed(seed)
        image = Image.open(io.BytesIO(image_bytes))
        # the official web demo removes the background whenever the photo has no transparency
        image = self.rembg(image.convert("RGB")) if image.mode != "RGBA" else image
        with tempfile.TemporaryDirectory() as d:
            img_path, shape_path, out_obj = f"{d}/input.png", f"{d}/shape.glb", f"{d}/textured.obj"
            image.save(img_path)
            mesh = self.shape(image=image, generator=torch.Generator("cuda").manual_seed(seed))[0]
            mesh.export(shape_path)
            t_shape = time.time() - t
            self.paint(mesh_path=shape_path, image_path=img_path, output_mesh_path=out_obj)
            data = open(out_obj.replace(".obj", ".glb"), "rb").read()
        print(f"generated in {time.time() - t:.0f}s (shape {t_shape:.0f}s), peak VRAM "
              f"{torch.cuda.max_memory_allocated() / 2**30:.1f} GiB, GLB {len(data) / 2**20:.1f} MiB")
        torch.cuda.empty_cache()
        return data


@app.local_entrypoint()
def main(images: str, out_dir: str = "demo/hunyuan3d"):
    import time
    os.makedirs(out_dir, exist_ok=True)
    model = Hunyuan3D()
    for path in images.split(","):
        t = time.time()
        data = model.generate.remote(open(path, "rb").read())
        out = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".glb")
        open(out, "wb").write(data)
        print(f"saved {out} ({len(data) / 2**20:.1f} MiB) in {time.time() - t:.0f}s round trip")
