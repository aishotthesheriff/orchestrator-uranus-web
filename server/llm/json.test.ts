import { describe, expect, it } from "vitest";
import {
  closeUnfinishedJson,
  diagnoseJson,
  parseStageJson,
  recoverStageOutput,
  salvageNarration,
} from "./json";

describe("recoverStageOutput: clean and wrapped JSON", () => {
  it("reports plain JSON as raw", () => {
    const result = recoverStageOutput('{"narration": "Hello"}');
    expect(result.quality).toBe("raw");
    expect(result.value).toEqual({ narration: "Hello" });
  });

  it("extracts JSON from a code fence", () => {
    const result = recoverStageOutput('Here you go:\n```json\n{"narration": "Hello"}\n```\nEnjoy!');
    expect(result.quality).toBe("extracted");
    expect(result.value).toEqual({ narration: "Hello" });
  });

  it("extracts JSON surrounded by prose", () => {
    const result = recoverStageOutput('Sure! {"actions": [{"action": "wave"}]} Let me know if you need more.');
    expect(result.quality).toBe("extracted");
    expect(result.value).toEqual({ actions: [{ action: "wave" }] });
  });

  it("is not fooled by braces inside strings", () => {
    const result = recoverStageOutput('Note: {"narration": "She said \\"}{\\" and left."} done');
    expect(result.quality).toBe("extracted");
    expect(result.value).toEqual({ narration: 'She said "}{" and left.' });
  });

  it("does not accept a bare scalar as a stage result", () => {
    expect(recoverStageOutput("42").quality).toBe("failed");
    expect(recoverStageOutput('"just a string"').quality).toBe("failed");
  });

  it("fails on an empty or missing response", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const result = recoverStageOutput(empty);
      expect(result.quality).toBe("failed");
      expect(result.error).toMatch(/empty response/);
    }
  });
});

describe("recoverStageOutput: repairing unfinished JSON", () => {
  // Shapes taken from real replies of a model without JSON mode.
  it("closes an object whose final brace is missing", () => {
    const result = recoverStageOutput('{\n  "narration": "The ship hums. Zara waits."', { stage: "narrative" });
    expect(result.quality).toBe("repaired");
    expect(result.value).toEqual({ narration: "The ship hums. Zara waits." });
  });

  it("closes an open string, array and object", () => {
    const result = recoverStageOutput('{"actions": [{"action": "wave", "summary": "Wave at the cr');
    expect(result.quality).toBe("repaired");
    expect(result.value).toEqual({ actions: [{ action: "wave", summary: "Wave at the cr" }] });
  });

  it("drops a dangling comma before closing", () => {
    const result = recoverStageOutput('{"a": 1, "b": [1, 2],');
    expect(result.quality).toBe("repaired");
    expect(result.value).toEqual({ a: 1, b: [1, 2] });
  });

  it("repairs an unfinished object inside an unclosed code fence", () => {
    const result = recoverStageOutput('```json\n{"imagePrompt": "A neon corridor"');
    expect(result.quality).toBe("repaired");
    expect(result.value).toEqual({ imagePrompt: "A neon corridor" });
  });

  it("never repairs a reply that was cut off at the token limit", () => {
    const cutOff = '{"actions": [{"action": "wave"}, {"action": "ru';
    const result = recoverStageOutput(cutOff, { stage: "actions", finishReason: "length" });
    expect(result.quality).toBe("failed");
    expect(result.error).toMatch(/cut off/);
    // The same text with a normal stop is repairable.
    expect(recoverStageOutput(cutOff, { stage: "actions", finishReason: "stop" }).quality).toBe("repaired");
  });

  it("still accepts a complete object from a reply that hit the limit afterwards", () => {
    const result = recoverStageOutput('{"narration": "Done."}\nAnd then the model rambled on unt', { finishReason: "length" });
    expect(result.quality).toBe("extracted");
  });
});

describe("recoverStageOutput: edge cases found in review", () => {
  it("finds the object when prose before it contains braces", () => {
    const result = recoverStageOutput('Here {is} the result: {"imagePrompt": "A corridor"}', { stage: "image" });
    expect(result.quality).toBe("extracted");
    expect(result.value).toEqual({ imagePrompt: "A corridor" });
    // And when that object is unfinished.
    const unfinished = recoverStageOutput('Here {is} the result: {"imagePrompt": "A corridor"', { stage: "image" });
    expect(unfinished.quality).toBe("repaired");
    expect(unfinished.value).toEqual({ imagePrompt: "A corridor" });
  });

  it("never takes a section of a broken object for the object itself", () => {
    // Real reply shape from a roleplay model: the outer object is broken further down
    // (mismatched quotes), but its first section is complete on its own.
    const broken = [
      "{",
      '  "context": { "turnMoment": "Desperate repairs", "tension": "High" },',
      '  "variables": { "riskSummary": "Everything" },',
      "  \"guidance\": { \"narrative\": [\"AEGIS-69's voice echoes.','Status: \"Hull breach imminent.\"'] }",
      "}",
    ].join("\n");
    const result = recoverStageOutput(broken, { stage: "master", finishReason: "stop" });
    // Not {turnMoment, tension}: that would silently drop the rest of the plan.
    expect(result.quality).toBe("failed");
  });

  it("never returns a section when the plan lost its opening brace", () => {
    const text = '"context": {"turnMoment": "m"}, "variables": {"risk": "s"}, "guidance": {"narrative": ["a"]}';
    for (const finishReason of ["stop", "length", null, undefined]) {
      expect(recoverStageOutput(text, { stage: "master", finishReason }).quality).toBe("failed");
    }
  });

  it("recovers past a lone unclosed brace in the prose before the object", () => {
    const image = recoverStageOutput('Use { to open. {"imagePrompt": "A corridor"}', { stage: "image", finishReason: "stop" });
    expect(image).toMatchObject({ quality: "extracted", value: { imagePrompt: "A corridor" } });
    const master = recoverStageOutput('Use { to open. {"context": {"a": 1}}', { stage: "master", finishReason: "stop" });
    expect(master).toMatchObject({ quality: "extracted", value: { context: { a: 1 } } });
  });

  it("does not take one action for the actions object", () => {
    // Outer object broken; the first action is a complete object on its own.
    const text = '{"actions": [{"action": "wave", "intent": "other"}, {"action": "run", "intent": oops}]}';
    expect(recoverStageOutput(text, { stage: "actions", finishReason: "stop" }).quality).toBe("failed");
  });

  it("without a stage, trusts only top-level blocks", () => {
    expect(recoverStageOutput('{"a": {"b": 1}, "c": oops}').quality).toBe("failed");
    expect(recoverStageOutput('Note {x} then {"a": 1}')).toMatchObject({ quality: "extracted", value: { a: 1 } });
  });

  it("never takes a nested object out of an unfinished one", () => {
    const result = recoverStageOutput('{"context": {"turnMoment": "x"}, "variables": {"risk": [1, 2', {
      stage: "master",
      finishReason: "length",
    });
    expect(result.quality).toBe("failed");
  });

  it("skips a stray object that lacks the stage's field", () => {
    const text = 'For example {"x": 1}. Now the answer: {"narration": "The real scene, written out in full."}';
    const result = recoverStageOutput(text, { stage: "narrative" });
    expect(result.quality).toBe("extracted");
    expect(result.value).toEqual({ narration: "The real scene, written out in full." });
  });

  it("does not accept a preamble object from a cut-off reply", () => {
    const text = 'Example {"x": 1} then {"enrichment": "abc';
    expect(recoverStageOutput(text, { stage: "master", finishReason: "length" }).quality).toBe("failed");
  });

  it("repairs only when the model stopped on its own", () => {
    const unfinished = '{"narration": "The ship hums and then';
    expect(recoverStageOutput(unfinished, { finishReason: "stop" }).quality).toBe("repaired");
    // Provider did not report why it stopped, or stopped it for another reason: do not guess.
    expect(recoverStageOutput(unfinished, { finishReason: null }).quality).toBe("failed");
    expect(recoverStageOutput(unfinished, { finishReason: "content_filter" }).quality).toBe("failed");
    expect(recoverStageOutput(unfinished, { stage: "narrative", finishReason: null }).quality).toBe("failed");
  });

  it("escapes raw line breaks inside strings", () => {
    // Seen from a roleplay model: a real newline typed inside the string.
    const text = '{"narration": "Line one.\nLine two.\tTabbed.", "toneHints": ["calm"]}';
    const result = recoverStageOutput(text, { stage: "narrative", finishReason: "stop" });
    expect(result.quality).toBe("repaired");
    expect(result.value).toEqual({ narration: "Line one.\nLine two.\tTabbed.", toneHints: ["calm"] });
  });

  it("does not leave half an escape when closing a string cut after a backslash", () => {
    const result = recoverStageOutput('{"imagePrompt": "A corridor\\', { stage: "image" });
    expect(result.quality).toBe("repaired");
    expect(result.value).toEqual({ imagePrompt: "A corridor" });
  });
});

describe("recoverStageOutput: salvaging narration", () => {
  const unquoted =
    '{\n  "narration": AEGIS-69 takes in the golden light. Captain Zara paces, restless, and says "hold course" twice.\n}';

  it("lifts unquoted narration out of broken JSON for the narrative stage", () => {
    const result = recoverStageOutput(unquoted, { stage: "narrative" });
    expect(result.quality).toBe("salvaged");
    expect(result.value).toEqual({
      narration: 'AEGIS-69 takes in the golden light. Captain Zara paces, restless, and says "hold course" twice.',
    });
  });

  it("does not salvage for other stages", () => {
    expect(recoverStageOutput(unquoted, { stage: "actions" }).quality).toBe("failed");
    expect(recoverStageOutput(unquoted).quality).toBe("failed");
  });

  it("does not salvage a cut-off narration", () => {
    expect(recoverStageOutput(unquoted.slice(0, 60), { stage: "narrative", finishReason: "length" }).quality).toBe("failed");
  });

  it("recovers narration whose inner quotes were not escaped", () => {
    const text = '{"narration": "Zara grins. "Punch it," she says, and the engines answer with a roar.", "toneHints": ["bold"]}';
    const result = recoverStageOutput(text, { stage: "narrative" });
    expect(result.quality).toBe("salvaged");
    expect((result.value as any).narration).toBe('Zara grins. "Punch it," she says, and the engines answer with a roar.');
  });
});

describe("salvageNarration: no JSON debris in the player's text", () => {
  const prose = "AEGIS-69 watches the light shift across the hull while the crew settles in";

  it("stops at any following field, not only toneHints", () => {
    expect(salvageNarration(`{"narration": ${prose}, "mood": "grim"}`)).toBe(prose);
    expect(salvageNarration(`{"narration": "${prose}, and he said "go"", "mood": "grim", "x": 1}`)).toBe(
      `${prose}, and he said "go"`
    );
  });

  it("drops a trailing lone backslash", () => {
    expect(salvageNarration(`{"narration": ${prose}\\`)).toBe(prose);
  });

  it("strips single quotes used as string delimiters", () => {
    expect(salvageNarration(`{"narration": '${prose}'}`)).toBe(prose);
  });

  it("keeps commas and quoted speech that are part of the prose", () => {
    const spoken = `${prose}, and Zara says "steady", twice`;
    expect(salvageNarration(`{"narration": ${spoken}}`)).toBe(spoken);
  });
});

describe("salvageNarration", () => {
  it("honours valid escapes in a quoted string", () => {
    expect(salvageNarration('{"narration": "Line one.\\nLine two, with a \\"quote\\" and enough length to count."')).toBe(
      'Line one.\nLine two, with a "quote" and enough length to count.'
    );
  });

  it("returns null without a narration field or with too little text", () => {
    expect(salvageNarration('{"story": "Long enough text but under the wrong key, so nothing to salvage."}')).toBeNull();
    expect(salvageNarration('{"narration": "Too short"')).toBeNull();
  });
});

describe("closeUnfinishedJson", () => {
  it("returns null when nothing is left open", () => {
    expect(closeUnfinishedJson('{"a": 1}')).toBeNull();
    expect(closeUnfinishedJson("no json here")).toBeNull();
  });
});

describe("diagnoseJson", () => {
  it("is the stage-agnostic reading: it repairs but never salvages", () => {
    expect(diagnoseJson('{"a": 1').quality).toBe("repaired");
    expect(diagnoseJson('{"narration": Unquoted prose that is long enough to be salvaged by the narrative stage}').quality).toBe("failed");
  });
});

describe("parseStageJson", () => {
  it("returns the value and records how it was read", () => {
    const metadata: any = { stage: "image", finishReason: "stop" };
    expect(parseStageJson('```json\n{"imagePrompt": "A corridor"}\n```', metadata)).toEqual({ imagePrompt: "A corridor" });
    expect(metadata.jsonQuality).toBe("extracted");
  });

  it("throws on unusable output, so the stage moves on to retry and fallback", () => {
    const metadata: any = { stage: "actions", finishReason: "stop" };
    expect(() => parseStageJson("I cannot help with that.", metadata)).toThrow();
    expect(metadata.jsonQuality).toBe("failed");
  });

  it("treats an empty reply as a failure even though it arrives as {}", () => {
    const metadata: any = { stage: "master", finishReason: "length", emptyResponse: true };
    expect(() => parseStageJson("{}", metadata)).toThrow(/empty response/);
  });

  it("uses the narrative salvage only for the narrative stage", () => {
    const text = '{"narration": Unquoted prose that is certainly long enough to be worth keeping for the player.}';
    const narrative: any = { stage: "narrative", finishReason: "stop" };
    expect(parseStageJson(text, narrative)).toEqual({
      narration: "Unquoted prose that is certainly long enough to be worth keeping for the player.",
    });
    expect(narrative.jsonQuality).toBe("salvaged");
    expect(() => parseStageJson(text, { stage: "master", finishReason: "stop" })).toThrow();
  });
});
