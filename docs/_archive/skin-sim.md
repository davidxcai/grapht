# AI Skin simulation

# Overview

**AI-Powered Skin Simulation: Visualizing Treatment Progress with Precision and Professionalism**

Our cutting-edge AI-driven skin simulation technology enables highly accurate before-and-after visualizations of facial skin conditions, allowing both professionals and consumers to objectively track the efficacy of skincare treatments over time. Engineered for high-fidelity realism and clinical-grade insights, this solution supports the visualization of up to ten distinct skin concerns, including radiance, acne, oiliness, eye bags, dark circles, spots, pores, texture, wrinkles and redness.

![](https://plugins-media.makeupar.com/smb/blog/post/2025-04-17/4edad54f-ef6b-4842-b104-d114889318b1.jpg)

By harnessing sophisticated machine learning models combined with advanced augmented reality capabilities, the system delivers realistic, non-invasive previews of potential outcomes using only a standard smartphone camera or desktop webcam. Each simulation is generated in seconds, offering users an immediate yet scientifically grounded understanding of how targeted skincare interventions may enhance their complexion over time.

![](https://plugins-media.makeupar.com/smb/blog/post/2025-11-13/webp_27e3ad50-7769-46de-822c-c9300f87f57d.webp)

Designed specifically for skincare brands, dermatology practices, aesthetic clinics, and retail beauty retailers, this platform integrates effortlessly across digital and physical touchpoints, including e-commerce websites, mobile applications, virtual consultations, and point-of-sale kiosks. Its versatility supports a wide array of use cases such as personalized regimen recommendations, product performance simulation, treatment planning for professional procedures, and interactive educational tools that strengthen client engagement and build trust in brand claims.

![](https://bcw-media.s3.ap-northeast-1.amazonaws.com/strapi/assets/AI_Skin_Simulation_pores_b1e209ee58.jpg)

Through objective visualization and data-driven storytelling, our AI skin simulation empowers skincare professionals to set realistic expectations, customize care plans, and demonstrate measurable progress, ultimately elevating the customer experience while reinforcing evidence-based efficacy in an increasingly competitive market landscape.

![](https://bcw-media.s3.ap-northeast-1.amazonaws.com/strapi/assets/AI_Skin_Simulation_283421234a.jpg)

---

## Integration Guide

This guide walks you through:

Workflow for AI Skin Simulation API:

**Endpoint:** `/s2s/v2.0/task/skin-simulation`

**Authentication Required:** `Authorization: Bearer YOUR_API_KEY`

**Workflow Steps:**

1. **Image Upload Preparation:**
    - The process begins with preparing a selfie image.

2. **AI Skin Simulation Settings**
   For each skin concern (e.g., wrinkle, pores, redness), adjust the **simulation intensity** using the value from **0.0 to 1.0**:
    - **0.0**: Shows your _original_ skin appearance—no changes.
    - **1.0**: Applies the _most natural, healthy-looking_ enhancement AI can generate for that concern.

    **How it works:**
    - At low settings (e.g., 0.2–0.4), fine lines or minor imperfections are subtly softened.
    - At higher settings (e.g., 0.7–1.0), more pronounced improvements occur, such as significant reduction in moderate or deep wrinkles, smoother texture, and improved tone, even while preserving natural skin details.

    Adjust gradually to achieve your desired look!

3. **Initiate AI Task and Obtain Task ID:**
    - Send the uploaded image along with the skin simulation configuration via an HTTP POST request to `/s2s/v2.0/task/skin-simulation`.
    - Await a unique task ID in the response, which identifies this interaction.

4. **Poll Task Status (Continuous Check):**
    - Use the obtained `task_id` to periodically poll the task status using an HTTP GET request (e.g., `GET /task/${task_id}`).
    - Continuously monitor for:
        - `Task_status = "success"` (process completed).
        - `Task_status = "error"` (resolve or retry if applicable).
    - Update the workflow accordingly once the status transitions to success.

This structured workflow ensures efficient integration with user inputs, automated monitoring of tasks, and seamless retrieval of results.

---

- Authentication

* Include your API key in the request header using **Bearer Token**:
  `     Authorization: Bearer YOUR_API_KEY
    `
  You can find your API Key at https://yce.makeupar.com/api-console/en/api-keys/.

---

- Upload an Image

You may upload a file directly to the server or provide a valid image URL in the AI task payload.

- Upload Endpoint

```
POST /s2s/v2.0/file
```

Alternatively, skip this step if you already have a public image URL.

---

- Adjust AI Skin Simulation Intensity
  **AI Skin Simulation Settings**

For each skin concern (e.g., wrinkle, pores, redness), adjust the **simulation intensity** on a scale from **0.0 to 1.0**:

- **0.0** → _Original appearance_ — no AI enhancement applied.
- **1.0** → _Maximum natural, healthy-looking improvement_ for that concern, as realistically rendered by our AI model.

**What to expect at different intensity levels:**

| Intensity Range | Effect                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.1 – 0.3**   | Subtle refinement — minor smoothing of fine lines, slight pore softening, or gentle redness reduction. Ideal for a natural “fresh-faced” look.                                            |
| **0.4 – 0.6**   | Balanced enhancement — noticeable improvement in texture and clarity while retaining individual skin character.                                                                           |
| **0.7 – 1.0**   | Full correction — significantly reduces moderate to deep wrinkles, evens tone, minimizes pores and redness, and enhances overall radiance—_without_ looking over-processed or artificial. |

**Pro Tip:** Start low (e.g., 0.2) and gradually increase until you reach the desired result in realism.

---

- Create a AI Skin Simulation AI Task and Poll for Results

After uploading an image and setting **at least one** skin concern's simulation intensity above 0.0, you can initiate a task. The API processes the request asynchronously. You must poll the task status until it reaches `success` or `error`.

- Create Task Endpoint

```
POST /s2s/v2.0/task/skin-simulation
```

- Polling Endpoint

```
GET /s2s/v2.0/task/skin-simulation/{task_id}
```

---

## File Specs & Errors

- AI Skin Simulation Specification

**Camera and Imaging Guidance**

**Lighting Conditions**
Ensure the environment is well-lit and evenly illuminated. Avoid strong backlighting, localized overexposure, or large shadows on the face. Use natural daylight or soft indoor lighting whenever possible. Do not use colored lights, including pink, blue, or other tinted sources, as they may distort skin tone representation.

**Face Position and Occlusion**
Capture a frontal view with the face directly facing the camera. The head rotation should be minimal; avoid excessive tilting or turning to either side. Ensure the entire face, including forehead, cheeks, and chin, is fully visible and unobstructed. Do not use hair, masks, hands, eyeglass frames, mobile phones, or any other objects that partially cover facial features.

**Facial Expression and Pose**
Maintain a natural, relaxed expression with both eyes open. The mouth may remain closed or slightly open, do not strain or exaggerate the pose.

**Face Size in Frame**
The face must occupy at least 60% of the image width to ensure sufficient detail for accurate analysis. Avoid capturing subjects that are too small, distant, or improperly framed.

![](https://plugins-media.makeupar.com/strapi/assets/thumbnail_skin_analysis_01_5b5defd339.png)

---

- Supported Formats & Dimensions

| AI Feature         | Supported Dimensions                 | Supported File Size | Supported Formats |
| ------------------ | ------------------------------------ | ------------------- | ----------------- |
| AI Skin Simulation | short side >= 480, long side <= 2560 | < 10MB              | jpg/jpeg/png      |

- Error Codes

| **Error Code**                | **Description**                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error_below_min_image_size`  | Input image resolution is below the minimum required size (e.g., < 256×256 pixels). Please upload a higher-resolution image.                                                                               |
| `error_exceed_max_image_size` | Input image resolution exceeds the maximum allowed size (e.g., > 2560×2560 pixels). Resize or downscale your image before uploading.                                                                       |
| `error_invalid_params`        | Invalid request parameters were provided.                                                                                                                                                                  |
| `error_src_face_too_small`    | The detected face occupies less than 60% of the image width—too small for accurate skin analysis. Use an image with a larger, clearer face centered in frame.                                              |
| `error_src_face_out_of_bound` | The detected face is partially or fully outside the image boundaries (e.g., face cropped too tightly). Please ensure the full face—including forehead, cheeks, and chin—is visible and properly framed.    |
| `error_lighting_dark`         | Ambient lighting in the image is insufficient for reliable skin analysis (e.g., underexposed, shadows dominate the face). Upload an image taken in well-lit conditions with even illumination on the face. |

- Environment & Dependency

| Sample Code Language / Tool | Recommended Runtime Versions                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| cURL                        | - bash >= 3.2</br> - curl >= 7.58 (modern TLS/HTTP support)</br> - jq >= 1.6 (robust JSON parsing)       |
| Node.js (JavaScript)        | Node >= 18 (for global fetch)                                                                            |
| JavaScript                  | - Chrome / Edge >= 80</br> - Firefox >= 74</br> - Safari >= 13.1                                         |
| PHP                         | PHP >= 7.4 (for modern TLS/compat), ext-curl (recommended) or allow_url_fopen=On + ext-openssl, ext-json |
| Python                      | Python >= 3.10 (for f-strings), requests >= 2.20.0                                                       |
| Java                        | Java 11+ (for HttpClient), Jackson Databind >= 2.12.0                                                    |

---

## JS Camera Kit

{% partial file="/_partials/js-camera-kit.md" /%}

License: Privacy policy

## Servers

```
https://yce-api-01.makeupar.com
```

## Security

### BearerAuthenticationV2

Use the standard 'Bearer authentication'. Put your 'API Key' in header: `Authorization:Bearer YOUR_API_KEY`. Notice that there is ' ' a space between 'Bearer' and the 'YOUR_API_KEY'.

Type: http
Scheme: bearer

## Download OpenAPI description

[AI Skin simulation](https://docs.perfectcorp.com/_bundle/reference/ai_skin_simulation.yaml)

## V1.0

Simulate skin texture changes (wrinkles, radiance, oiliness, etc.) on uploaded images using AI processing.

### Run an AI Skin Simulation task.

- [POST /s2s/v2.0/task/skin-simulation](https://docs.perfectcorp.com/reference/ai_skin_simulation/v1.0/paths/~1s2s~1v2.0~1task~1skin-simulation/post.md): This endpoint initiates the skin simulation process. You must provide a source file (via URL or File ID) and specify the simulation parameters (wrinkle, radiance, etc.). At least one parameter cannot be zero. The task will be processed asynchronously, and you can check its status using the task_id returned in this response.

### Check the status of a AI Skin Simulation task.

- [GET /s2s/v2.0/task/skin-simulation/{task_id}](https://docs.perfectcorp.com/reference/ai_skin_simulation/v1.0/paths/~1s2s~1v2.0~1task~1skin-simulation~1%7Btask_id%7D/get.md)
