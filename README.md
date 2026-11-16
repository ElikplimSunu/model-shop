# Model Shop

Turn a photo or a short description into a 3D model you can turn, inspect and download.
Model Shop runs Microsoft's TRELLIS.2 on your own rented GPU (it reads the photo with Meta's DINOv3).
A description first becomes a picture (FLUX, hosted by NVIDIA), which you check before the GPU starts.

![Model Shop's Objects page: the source panel with the model picker on the left, a TRELLIS.2 mug made from its photo on a drafting grid in the middle, the run log on the right](docs/model-shop.png)

## What it does

- **Photo to 3D.** Drop in a JPG, PNG or WebP of one object. You get a textured 3D model (GLB).
- **Description to 3D.** Describe one object in a sentence. It becomes a picture in about 10 seconds; if the picture matches your words, the photo path turns it into 3D. If not, make another picture (free).
- **Pick the model.** TRELLIS.2 (the default), TRELLIS v1 or Hunyuan3D-2.1, each on its own GPU, so you can compare them on the same picture. The run log names the model behind each result.
- **Draft or High.** High uses TRELLIS.2's finest pass and Microsoft's own export settings: finer detail, about 3 times the time and file size.
- **Inspect.** Turn and zoom, turntable, wireframe, reset view. The corner readout shows proportions, triangle count and file size, with the source photo pinned beside the model.
- **Keep.** Download any result as `.glb`, open any `.glb` from your computer, and click back through every model made in the tab.
- **Buildings from measurements.** The Buildings page turns walls, doors, windows and floor heights, typed as numbers in metres, into an exact 3D building at true size, with the dimensions on screen and a `.glb` download. No AI is involved, so nothing is guessed.
- **Honest waiting.** A cold GPU takes minutes: TRELLIS.2 Draft took 4:09 and 5:38 from cold in our runs through the app. The page shows elapsed time against the usual window instead of a made-up progress bar.

The interface is laid out like an architect's drawing sheet (title block, crop marks, hatching, a scale bar), because the long-term goal is buildings: see [Roadmap](#roadmap).

## How it works

```
browser ──> Next.js API route ──> Modal web endpoint ──> NVIDIA L40S GPU ──> GLB back to the viewer
            app/api/generate-model   checks the API key     TRELLIS.2 (photo) or
                                     on a small CPU first   TRELLIS text-xlarge (text)
```

For a photo, TRELLIS.2 works in four steps:

1. **Read the photo.** The background is cut away (BiRefNet), then Meta's DINOv3 vision model turns the photo into features.
2. **Block out.** The model decides which cells of a coarse 3D grid the object fills.
3. **Detail.** Inside those cells it adds fine shape and surface colour.
4. **Export.** The result becomes a triangle mesh with a painted texture, saved as one `.glb` file.

Descriptions get a step 0: FLUX draws the object as a product shot (one object, plain white background), you approve it, and it goes through steps 1 to 4. Microsoft's TRELLIS README recommends this over its text models, and our test agreed: the text model turned a brutalist concrete tower into a wooden lookout, the picture route kept it concrete.

## Models we compared

Same three photos, same GPU (L40S), seed 42. Seconds of GPU work once the model is loaded:

| Model | Cut-out example | Carved chair | Mug | Notes |
|---|---:|---:|---:|---|
| **TRELLIS.2** (Microsoft) | 133 | 48 | 91 | In use for photos. Largest files (300,000 faces, 2048 px texture). |
| TRELLIS v1 (Microsoft) | 52 | 26 | 24 | Fastest, smallest files (1024 px texture). |
| Hunyuan3D-2.1 (Tencent) | 104 | 90 | 80 | PBR textures; reduces to 40,000 faces. |

A cold start adds about two minutes on top (most of it is waiting for Modal to hand over a GPU).

## Run it yourself

You need: Node (current LTS, through nvm), [pnpm](https://pnpm.io), a [Modal](https://modal.com) account with the `modal` CLI (version 1.6.x; see the note below), and a [Hugging Face](https://huggingface.co) account.

**1. Get access to DINOv3.** TRELLIS.2 needs Meta's gated model
[`facebook/dinov3-vitl16-pretrain-lvd1689m`](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m).
Request access on that page while signed in to Hugging Face. Meta approves by hand, so it can take a while.
Then create a Hugging Face read token.

**2. Put the GPU side on Modal.** Pick any long random string as your API key.

```bash
modal secret create trellis-3d API_KEY=<your-random-key> HF_TOKEN=<your-hf-read-token>

modal run trellis_modal.py::check_imports    # CPU: builds the image, checks the libraries
modal run trellis_modal.py::download         # CPU: caches the weights in a Modal volume
modal deploy trellis_modal.py                # photo endpoint

```

Optional, for the model picker: the same three steps for `trellis1_modal.py` (TRELLIS v1) and `hunyuan3d_modal.py` (Hunyuan3D-2.1). Both endpoints use the same API key. `trellis1_modal.py` also holds the older direct text-to-3D model, which the app no longer uses.

Each `deploy` prints an endpoint address ending in `.modal.run`.

**3. Point the app at it.** Create `.env.local` in the project root:

```env
MODAL_TRELLIS_URL=<photo endpoint address>
MODAL_TRELLIS_KEY=<your-random-key>
NVIDIA_API_KEY=<key from build.nvidia.com>   # pictures for descriptions (FLUX.1-dev, free trial credits)
MODAL_TRELLIS1_URL=<TRELLIS v1 generate_image address>   # optional, model picker
MODAL_HUNYUAN_URL=<Hunyuan3D-2.1 generate address>       # optional, model picker
```

A model picked without its address set answers with an error; it never falls back to TRELLIS.2.

FLUX.1-dev's weights carry a non-commercial licence. Check NVIDIA's and Black Forest Labs' terms before any paid use.

**4. Run.**

```bash
pnpm install
pnpm run build && pnpm run start     # http://localhost:3000, this computer only
```

Both scripts listen on 127.0.0.1 only, on purpose: anyone who can open the app can spend your GPU credits. Do not put it on a network or the internet without a login and rate limits in front of it.

### Costs and guards

An L40S costs about $1.95 an hour on Modal, plus a little CPU and memory. A cold photo run cost about $0.28 in our tests; a warm Draft run a few cents, a warm High run roughly 11 to 16 cents (estimates). Every Modal function keeps one GPU at most, shuts down after 60 seconds idle, caps each job at 10 minutes, and checks the API key on a CPU before any GPU starts. Set a spending limit in Modal's settings too.

To get faster runs for a demo, send one photo and one description about five minutes before. Photos and descriptions each have their own GPU, and each handles one job at a time.

**Note:** Modal CLI 1.7.0 and later refuses Python 3.10 images, which the TRELLIS scripts use. Stay on 1.6.x until they move to Python 3.11.

### Without Modal

If `MODAL_TRELLIS_URL` is not set, photos (and pictures made from descriptions) go to the public `microsoft/TRELLIS.2` Hugging Face Space (set `HF_TOKEN` in `.env.local`; the free quota is about one image a day, and the Draft/High switch does not apply there).

## Project layout

| Path | What it is |
|---|---|
| `app/layout.tsx`, `app/workshop.tsx` | Shared header and page links; the run log and any job on the GPU live here, so changing page never drops a result |
| `app/page.tsx` | Objects: the workbench (photo or description to 3D), waiting panel, title block |
| `app/buildings/page.tsx` | Buildings: samples, the numbers editor, measured facts |
| `app/how-it-works/page.tsx` | How it works: the notes sheet |
| `app/components/InputHandler.tsx` | Photo and description input |
| `app/components/ModelViewer.tsx` | 3D view (React Three Fiber): lighting, grid, camera fit, tools |
| `app/components/Notes.tsx` | The "How a photo becomes a model" sheet |
| `app/components/BuildingViewer.tsx` | 3D view of a building at true scale, with dimension labels and export |
| `lib/building.ts` | A building as numbers, turned into exact walls, openings and slabs; checks for impossible numbers |
| `lib/building.test.ts` | Measures the built pieces against the numbers (`pnpm exec vitest run lib`) |
| `app/api/generate-image/route.ts` | Turns a description into a product-shot picture (FLUX on NVIDIA) |
| `app/api/generate-model/route.ts` | Sends a picture to Modal (or the fallback) and returns the GLB |
| `trellis_modal.py` | TRELLIS.2 on Modal: the photo endpoint, with Draft and High settings |
| `trellis1_modal.py` | TRELLIS v1 (image endpoint for the model picker) and TRELLIS text-xlarge on Modal |
| `hunyuan3d_modal.py` | Hunyuan3D-2.1 on Modal (endpoint for the model picker) |
| `lib/cursor-swarm.js` | Vendored animation library that draws the notes sheet |
| `public/samples/` | A ready-made TRELLIS.2 model of a mug, so the viewer can be tried without a GPU |

Built with Next.js 16, React 19, React Three Fiber and Three.js, TypeScript.

## Roadmap

- **Read a drawing.** Turn a real plan (CAD file, PDF or scan) into the numbers the Buildings page uses, then check the result against the drawing's own dimensions.
- Several views of one object (front, sides, back) into a model built for it, so the sides a single picture never shows stop being guesses.
- A check that compares the finished model with its picture before you see it.
- Faster cold starts (cache compiled GPU kernels in the Modal volume).

## Credits

- [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) and [TRELLIS](https://github.com/microsoft/TRELLIS) by Microsoft (MIT).
- [DINOv3](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m) by Meta (DINOv3 License, gated).
- [BiRefNet](https://huggingface.co/ZhengPeng7/BiRefNet) (MIT), for background removal.
- [FLUX.1-dev](https://huggingface.co/black-forest-labs/FLUX.1-dev) by Black Forest Labs (FLUX.1 [dev] Non-Commercial License), used through NVIDIA's hosted API for pictures made from descriptions.
- [Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) by Tencent, compared only.
- [cursor-swarm.js](https://github.com/ZhengLinLei/cursor-swarm.js) by ZhengLinLei (MIT).
- Sample mug photo by Alexandru Stavrică (CC0).
