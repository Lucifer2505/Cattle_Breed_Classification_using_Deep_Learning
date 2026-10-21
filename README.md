# Cattle Breed Identifier

A client-side Progressive Web App that classifies photos into 50 Indian cattle-breed labels using ONNX Runtime Web. Photos are processed in the browser and are not uploaded. There is no application backend or account system. The optional feedback form sends its message and device metadata to Web3Forms.

## Features

- Upload a JPEG, PNG, or WebP photo, or capture one with the camera.
- Run the model on the device using WebGPU when available, with a WASM option.
- Show the top three model matches. If the top softmax score is below 40%, the breed name is hidden and an indistinct-image message is shown. Scores from 40% to 60% include a caution. These are app thresholds, not measured accuracy guarantees.
- Use the interface in English or Hindi. Hindi results display Devanagari breed names while preserving the original class labels and order used by the model.
- Switch between the light theme and the forest high-contrast theme.
- Cache the app shell and optionally store the model locally for offline use. Browsers may evict stored data.
- Send optional feedback through Web3Forms. Photos and model results are not included in feedback submissions.

## Model files

The model expects an input tensor named `images` with shape `[1, 3, 224, 224]` and returns raw logits named `logits` for 50 classes. The app applies softmax and reads labels in order from `models/classes.json`; do not sort or reorder that file.

The ONNX graph refers to external weights named `cattle_breeds.onnx.data`. The 112 MB data file is stored in this repo as two ordered chunks, each below GitHub's 100 MB per-file limit:

- `models/cattle_breeds.onnx.data.0` - 56,165,836 bytes
- `models/cattle_breeds.onnx.data.1` - 56,165,836 bytes

At runtime the app downloads and joins both chunks in order, then provides the combined bytes to ONNX Runtime using the filename embedded in the graph. The expected combined minimum is 112,331,672 bytes.

If you need to recreate the chunks from the original `.data` file, run this from the repository root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\split-weights.ps1 -InputPath .\cattle_breeds.onnx.data -OutputDirectory .\models
```

The script streams the input, checks that the reconstructed SHA-256 matches the source, and prints each chunk's size and hash. It does not overwrite existing chunks unless you add `-Force`. Keep the `.0` then `.1` order. If you export different model weights, update the chunk sizes and minimum byte count in `js/model-config.js`, and replace the ONNX graph and class list with the matching files.

The original `models/cattle_breeds.onnx.data` is ignored by Git because it exceeds GitHub's per-file limit. Commit both chunk files instead.

## Deploy to GitHub Pages

The repository already includes a GitHub Actions workflow at `.github/workflows/pages.yml`. It runs when code is pushed to `main`, installs the ONNX Runtime Web files using `scripts/copy-runtime.sh`, runs the deployment checker, and publishes the site. It can also be started manually from the repository's **Actions** tab.

1. Check that both chunk files are present and tracked by Git.
2. From the repository root, run the pre-deploy check:

   ```powershell
   node scripts/check-deploy.mjs
   ```

   Continue when it reports `Deploy checks passed`.
3. Commit and push your changes to the `main` branch:

   ```powershell
   git add -A
   git commit -m "Deploy cattle breed app"
   git push origin main
   ```

4. On GitHub, open **Settings > Pages** and set **Build and deployment > Source** to **GitHub Actions**.
5. Open **Actions** and wait for the Pages workflow to complete successfully. The published URL appears in the workflow run and in **Settings > Pages**. The default format is `https://<username>.github.io/<repository>/`.

The workflow currently installs ONNX Runtime Web version `1.22.0`. It needs Node.js/npm and network access in the GitHub Actions runner. GitHub Pages does not provide the cross-origin isolation headers required for multi-threaded WASM, so the app uses a single WASM thread unless another supported backend is available.

## Local development

To install the runtime files locally, use a shell with `sh` and npm (for example, Git Bash on Windows):

```sh
sh scripts/copy-runtime.sh
```

Then start a local static server from the repository root:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/`. Do not open `index.html` directly from the filesystem; the service worker and model loading require HTTP or HTTPS. Run `node scripts/check-deploy.mjs` to repeat the deployment checks. Add `?debug` to the URL to display timing information.

## Feedback and privacy

The Web3Forms access key in `js/feedback-config.js` is sent to browsers and is public by design. Restrict it to your deployed domain in the Web3Forms dashboard and enable the spam protections available to your account. Do not put private credentials in frontend code. The feedback form sends the user's message, optional email, and listed device/browser metadata; it does not send the selected photo or model result. Feedback requires an internet connection.

## Verification status

The current weights were loaded by ONNX Runtime Web in WASM and produced 50 finite logits for a synthetic image. This verifies model loading and execution, not classification accuracy. Test with known cattle photos before relying on predictions. WebGPU support for this graph, real-photo label agreement, real-device speed and memory use, other browsers, and a real Web3Forms submission have not been verified. See `CHECKLIST.md` for the remaining checks.

The model always chooses among its 50 labels, so non-cattle photos may still receive a breed prediction. Browser image resizing and EXIF orientation can also differ from the training pipeline.

## **Live Demo**
[https://lucifer2505.github.io/Cattle_Breed_Classification_using_Deep_Learning/] 
                        OR 
[https://tinyurl.com/CattleBreedClassifier]
