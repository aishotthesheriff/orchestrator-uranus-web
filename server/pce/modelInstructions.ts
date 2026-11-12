export type ModelInstructionClass = "flux" | "transformer" | "diffuser" | "fallback";

export type ModelInstructionSet = {
  style: string;
  output: string;
  example: string;
  modelClass: ModelInstructionClass;
};

const baseJsonReminder = "Return ONLY valid JSON (no markdown, no code fences, no extra text).";

const fluxStyle = `<<<FLUX FORMAT>>>
- **2-4 descriptive sentences/fragments with periods**
- **Natural, flowing language (20-40 words)**
- **Concrete details, grounded descriptions**
- **Write natural language sentences ending with periods**
- **Weave STYLE details naturally or append them at the end**
- **Provide a single string prompt; no negative prompt field**
- **Diffusion modifiers:** {{STYLE_DIFFUSION_MODIFIERS}}
- **Transformer modifiers:** {{STYLE_TRANSFORMER_MODIFIERS}}

**TEMPLATE:**  
[Subject with pose/action]. [Key details, setting elements]. [Atmosphere, lighting]. [STYLE].

**EXAMPLE:**  
Young woman crouched in urban alley, clutching glowing blue data chip. Graffiti walls wet from rain, trash bags in foreground, distant police lights. Dramatic neon lighting, cold misty air. Cyberpunk digital painting.
<<<FLUX FORMAT>>>`;

const transformerStyle = `<<<TRANSFORMER FORMAT>>>
- **2-3 complete, flowing sentences (25-45 words)**
- **Cohesive narrative description**
- **Slightly more compositional language OK**
- **Write natural language sentences ending with periods**
- **Integrate STYLE descriptors naturally or append them tastefully**
- **Provide a single string prompt; do not emit a negative prompt**
- **Diffusion modifiers:** {{STYLE_DIFFUSION_MODIFIERS}}
- **Transformer modifiers:** {{STYLE_TRANSFORMER_MODIFIERS}}

**TEMPLATE:**  
A realistic scene of [subject doing X with details]. [Setting and environment]. [Lighting/atmosphere]. [STYLE].

**EXAMPLE:**  
A realistic scene of a young woman crouching in a narrow urban alley, clutching a glowing blue data chip that illuminates her face. Wet graffiti-covered walls reflect neon signs, with trash bags in foreground and blurred police lights in the distance. Cyberpunk digital painting.
<<<TRANSFORMER FORMAT>>>`;

const diffuserStyle = `<<<DIFFUSER FORMAT>>>
- **Comma-separated tags with weight modifiers**
- **Positive: 40-80 words | Negative: 10-25 words**
- **Technical, optimization-focused**
- **Use (style:1.4) weight notation where appropriate**
- **Distribute STYLE modifiers with consistent weighting across the prompt hierarchy**
- **Return both positive and negative prompts inside the JSON object**
- **Diffusion modifiers:** {{STYLE_DIFFUSION_MODIFIERS}}
- **Transformer modifiers:** {{STYLE_TRANSFORMER_MODIFIERS}}

**POSITIVE TEMPLATE:**  
(photorealistic:1.3), (ultra detailed), [subject + details], [pose/state], [setting], [lighting], [technical specs], [STYLE]

**QUALITY TAGS TO USE:**  
(photorealistic:1.3), (masterpiece:1.2), (ultra detailed), (sharp focus), RAW style, cinematic lighting

**NEGATIVE TEMPLATE:**  
cartoon, anime, cgi, lowres, blurry, bad anatomy, extra limbs, deformed hands, watermark, text, oversaturated

**EXAMPLE:**  

{
  "positive": "(masterpiece:1.2), (photorealistic:1.3), young woman crouched in urban alley, clutching glowing blue data chip, face illuminated by cyan light, fear and determination expression, graffiti concrete walls wet from rain, low-angle perspective, trash bags foreground, blurred police lights background, dramatic neon lighting, heavy shadows, (ultra detailed), cool blue and magenta palette, cyberpunk digital painting",
  "negative": "bad anatomy, extra limbs, deformed hands, watermark, text, oversaturated"

}
<<<DIFFUSER FORMAT>>>`;

const fluxOutput = `${baseJsonReminder}

When IMAGE_MODEL.class is "flux", reply with:
{
  "narration": "<your 3-6 sentence narration>",
  "image_prompt": "<formatted image prompt>"
}`;

const transformerOutput = `${baseJsonReminder}

When IMAGE_MODEL.class is "transformer", reply with:
{
  "narration": "<your 3-6 sentence narration>",
  "image_prompt": "<formatted image prompt>"
}`;

const diffuserOutput = `${baseJsonReminder}

When IMAGE_MODEL.class is "diffuser", reply with:
{
  "narration": "<your 3-6 sentence narration>",
  "image_prompt": {
    "positive": "<positive prompt>",
    "negative": "<negative prompt>"
  }
}`;

const fallbackStyle = `${fluxStyle}


${transformerStyle}


${diffuserStyle}`;

const fallbackOutput = `${baseJsonReminder}

IMAGE_MODEL.class is unrecognized. Default to transformer formatting:
{
  "narration": "<your 3-6 sentence narration>",
  "image_prompt": "<formatted image prompt>"
}`;

const fluxExample = `{
  "narration": "Starboard observation deck holds its breath as the solar storm peels across the hull, painting the glass in flickering violet.",
  "image_prompt": "Officer framed against Uranus' storms, hands braced on railing as solar auroras ignite the observation deck. Reflections ripple across reinforced glass, crew silhouettes gathered behind her. Cool teal lighting, brief crimson pulse from warning sirens. Galactic Noir."
}`;

const transformerExample = `{
  "narration": "Starboard observation deck holds its breath as the solar storm peels across the hull, painting the glass in flickering violet.",
  "image_prompt": "A realistic scene of the crew standing at the observation deck while a solar storm arcs across Uranus' cloud tops. Glass panels shimmer with reflected aurora light, control consoles glow cobalt around them. Dramatic rim lighting and elongated shadows sell the tension. Galactic Noir."
}`;

const diffuserExample = `{
  "narration": "Starboard observation deck holds its breath as the solar storm peels across the hull, painting the glass in flickering violet.",
  "image_prompt": {
    "positive": "(masterpiece:1.2), (photorealistic:1.3), observation deck crew silhouetted against Uranus storms, officer gripping railing, solar auroras exploding across reinforced glass, control consoles casting cobalt glow, warning siren pulses crimson, cinematic lighting, tension and awe, Galactic Noir, (noir diffusion:1.2), (smoky shadows:1.1)",
    "negative": "cartoon, anime, lowres, blurry, bad anatomy, extra limbs, watermark, text, oversaturated"
  }
}`;

const fallbackExample = transformerExample;

/**
 * Builds the instruction set (style guidance, output contract, example)
 * for the provided image model class. Defaults to fallback instructions
 * when an unrecognized model class is supplied.
 */
export function buildModelInstructionSet(modelClass: string | null | undefined): ModelInstructionSet {
  const normalized = (modelClass ?? "").toLowerCase();
  switch (normalized) {
    case "flux":
      return {
        style: fluxStyle,
        output: fluxOutput,
        example: fluxExample,
        modelClass: "flux"
      };
    case "transformer":
      return {
        style: transformerStyle,
        output: transformerOutput,
        example: transformerExample,
        modelClass: "transformer"
      };
    case "diffuser":
      return {
        style: diffuserStyle,
        output: diffuserOutput,
        example: diffuserExample,
        modelClass: "diffuser"
      };
    default:
      return {
        style: fallbackStyle,
        output: fallbackOutput,
        example: fallbackExample,
        modelClass: "fallback"
      };
  }
}
