"""Z-Image Turbo text-to-picture on Modal, behind the same API key as the 3D models.

Alibaba Tongyi's 6B model, Apache 2.0 (open for commercial use), 8 steps. It makes the picture a
description becomes before TRELLIS.2 turns it into 3D; the app's other choices are FLUX on NVIDIA
and Google's Nano Banana.

One-off setup (CPU only, cheap):
    modal run zimage_modal.py::download         # caches the weights (about 20 GB) in the zimage-weights volume
Test on the GPU (one container, pictures to demo/pictures/zimage/):
    modal run zimage_modal.py --prompts "a red chair|a brass lamp"
Deploy the endpoint:
    modal deploy zimage_modal.py

Credit guards: one GPU container at most, it shuts down after 60 s idle, every job is capped at
5 min, and a CPU function checks the API key before the GPU is ever started.
"""

from __future__ import annotations

import os

import modal

VOL = "/vol"
MODEL_DIR = f"{VOL}/Z-Image-Turbo"

app = modal.App("zimage")
vol = modal.Volume.from_name("zimage-weights", create_if_missing=True)
secret = modal.Secret.from_name("trellis-3d")  # API_KEY, shared with the 3D endpoints

# ZImagePipeline is in diffusers from 0.36; 0.42.1 is the release before the newest.
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.6.0", "diffusers==0.42.1", "transformers==5.21.1", "accelerate==1.12.0",
    "safetensors", "pillow==12.0.0", "huggingface_hub",
).env({"HF_HUB_DISABLE_PROGRESS_BARS": "1"})


@app.function(image=image, volumes={VOL: vol}, timeout=3600)
def download():
    from huggingface_hub import snapshot_download

    try:  # ungated; the sample pictures in assets/ are not needed
        snapshot_download("Tongyi-MAI/Z-Image-Turbo", local_dir=MODEL_DIR, ignore_patterns=["assets/*"])
        print("weights cached")
    finally:
        vol.commit()


@app.cls(image=image, gpu="L40S", volumes={VOL: vol}, timeout=300, scaledown_window=60, max_containers=1)
class ZImage:
    @modal.enter()
    def load(self):
        import time
        import torch
        from diffusers import ZImagePipeline

        t = time.time()
        self.pipe = ZImagePipeline.from_pretrained(MODEL_DIR, torch_dtype=torch.bfloat16, low_cpu_mem_usage=False).to("cuda")
        print(f"model loaded in {time.time() - t:.0f}s")

    @modal.method()
    def generate(self, prompt: str, seed: int | None = None) -> bytes:
        import io, random, time  # noqa: E401
        import torch

        t = time.time()
        # Settings from the model card: 9 steps (8 model passes), no guidance for Turbo.
        pic = self.pipe(prompt=prompt, height=1024, width=1024, num_inference_steps=9, guidance_scale=0.0,
                        generator=torch.Generator("cuda").manual_seed(random.randrange(2**31) if seed is None else seed)).images[0]
        buf = io.BytesIO()
        pic.convert("RGB").save(buf, "JPEG", quality=92)
        print(f"picture in {time.time() - t:.1f}s, peak VRAM {torch.cuda.max_memory_allocated() / 2**30:.1f} GiB")
        return buf.getvalue()


web_image = modal.Image.debian_slim().pip_install("fastapi[standard]")
with web_image.imports():
    from fastapi import Request


@app.function(image=web_image, secrets=[secret], timeout=300)
@modal.fastapi_endpoint(method="POST")
async def generate(request: Request):
    """POST {"prompt": "..."} with `Authorization: Bearer <API_KEY>`; returns a 1024 px JPEG."""
    import hmac
    from fastapi import HTTPException
    from fastapi.responses import Response

    sent = request.headers.get("authorization", "")
    if not hmac.compare_digest(sent.encode(), f"Bearer {os.environ['API_KEY']}".encode()):
        raise HTTPException(401, "Invalid API key")  # checked on CPU, so a bad request never starts the GPU
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    prompt = body.get("prompt") if isinstance(body, dict) else None
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 1500:
        raise HTTPException(400, "Send a prompt of 1 to 1500 characters")
    return Response(await ZImage().generate.remote.aio(prompt.strip()), media_type="image/jpeg")


@app.local_entrypoint()
def main(prompts: str, out_dir: str = "demo/pictures/zimage", seed: int = 42):
    """Prompts separated by |; all run in one warm container, so the model loads once."""
    import time
    os.makedirs(out_dir, exist_ok=True)
    model = ZImage()
    for i, p in enumerate(prompts.split("|"), 1):
        t = time.time()
        data = model.generate.remote(p.strip(), seed)
        out = os.path.join(out_dir, f"{i}.jpg")
        open(out, "wb").write(data)
        print(f"saved {out} ({len(data) / 1024:.0f} KB) in {time.time() - t:.0f}s round trip")
