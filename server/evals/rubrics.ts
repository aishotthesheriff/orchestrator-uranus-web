/**
 * Default rubrics for the LLM judges. Each judge reads one part of a generated turn and
 * returns a 1-5 score with its reasoning.
 *
 * To change a rubric without a deploy, create a prompt template named
 * `eval_judge_<key>` in Dev Tools > Prompts; its system content replaces the rubric here.
 */

import type { TurnEvalInput, TurnEvalOutput } from "./evaluators";

export interface JudgeSpec {
  key: string;
  title: string;
  description: string;
  /** System prompt: what to grade and how. */
  rubric: string;
  /** Whether this turn has what the judge grades. */
  applies: (output: TurnEvalOutput) => boolean;
  /** User prompt: the material to grade. */
  material: (input: TurnEvalInput, output: TurnEvalOutput) => string;
}

const ANSWER_FORMAT = `Reply with JSON only, in this shape:
{"reasoning": "<two or three sentences naming the specific evidence>", "score": <integer 1-5>}`;

function describeRequest(input: TurnEvalInput): string {
  const checks = input.checks.length
    ? input.checks
        .map((c) => `${c.skill ?? "skill"} check: ${c.success ? "SUCCESS" : "FAILURE"}${c.description ? ` (${c.description})` : ""}`)
        .join("\n")
    : "No skill check this turn.";
  return [
    `Player action: ${input.playerAction}`,
    `Skill checks:\n${checks}`,
    `Triggered event: ${input.triggeredEvent ? input.triggeredEvent.name : "none"}`,
    `Story theme: ${input.theme ?? "default"}`
  ].join("\n\n");
}

export const JUDGES: JudgeSpec[] = [
  {
    key: "narration_quality",
    title: "Narration quality",
    description: "The narration follows from the player's action and the dice, fits the theme, and reads well.",
    rubric: `You grade one turn of narration from a space-voyage text adventure whose tone is set by its story theme.

Grade how well the narration serves the turn it was written for:
- Outcome: it shows the player's action happening and its result matches each skill check (a SUCCESS reads as a success, a FAILURE as a setback). A narration that contradicts a check scores 1 or 2 no matter how well it is written.
- Event: if an event was triggered, it appears in the narration.
- Theme: voice and tone fit the stated story theme.
- Craft: concrete and specific, second person, no dice numbers or game mechanics leaking into the prose, no summary of what the player might do next.

5 = all four hold. 4 = outcome right, one minor weakness. 3 = outcome right but flat, generic or off-theme. 2 = outcome muddled or partly contradicted. 1 = contradicts the outcome or ignores the action.

${ANSWER_FORMAT}`,
    applies: (output) => !!output.narration,
    material: (input, output) => `${describeRequest(input)}\n\nNarration to grade:\n${output.narration}`
  },
  {
    key: "action_relevance",
    title: "Action relevance",
    description: "The offered actions follow from the narration and give the player real, distinct choices.",
    rubric: `You grade the list of next actions offered to the player after one turn of a space-voyage text adventure.

Grade the list as a set of choices:
- Grounded: each action responds to something in the narration (a person, object, problem or opening it mentions).
- Distinct: the actions are different things to do, not rewordings of one idea.
- Varied risk: the risk labels differ where the situation allows, and each label matches how risky the action sounds.
- Playable: each is something the player character could attempt right now.

5 = all four hold. 4 = one action is weak or generic. 3 = several are generic or two overlap. 2 = most ignore the narration. 1 = unrelated to the scene or unusable.

${ANSWER_FORMAT}`,
    applies: (output) => !!output.narration && output.actions.length > 0,
    material: (_input, output) =>
      `Narration:\n${output.narration}\n\nActions to grade:\n${output.actions
        .map((a, i) => `${i + 1}. [${a.risk}, ${a.intent}] ${a.action} - ${a.summary}`)
        .join("\n")}`
  },
  {
    key: "image_prompt_fidelity",
    title: "Image prompt fidelity",
    description: "The image prompt depicts the scene that was narrated, in the requested visual style.",
    rubric: `You grade a text-to-image prompt written to illustrate one turn of a space-voyage text adventure.

Grade whether an artist given only this prompt would draw the narrated scene:
- Same scene: the main subject, setting and key moment of the narration are in the prompt. Nothing important is invented or contradicted.
- Visual: it describes what is seen (subjects, composition, lighting), not plot, dialogue or feelings that cannot be drawn.
- Style: it reflects the stated visual style.
- Clean: no instructions to render text or captions, no leftover template placeholders.

5 = all four hold. 4 = scene right, one minor weakness. 3 = recognisably the scene but vague or partly off-style. 2 = wrong moment or missing the main subject. 1 = a different scene, or not usable as an image prompt.

${ANSWER_FORMAT}`,
    applies: (output) => !!output.narration && !!output.imagePrompt,
    material: (input, output) =>
      `Visual style: ${input.style ?? "default"}\n\nNarration:\n${output.narration}\n\nImage prompt to grade:\n${output.imagePrompt}`
  }
];

export function getJudge(key: string): JudgeSpec | undefined {
  return JUDGES.find((judge) => judge.key === key);
}
