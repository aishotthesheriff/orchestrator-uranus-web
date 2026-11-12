import { useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CatalogSection } from "./llm/CatalogSection";
import { DiscoverSection } from "./llm/DiscoverSection";
import { PlaygroundSection } from "./llm/PlaygroundSection";
import { QualifySection } from "./llm/QualifySection";
import type { CatalogDraft, TestTarget } from "./llm/shared";

type Section = "catalog" | "discover" | "playground" | "qualify";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "catalog", label: "Catalog" },
  { id: "discover", label: "Discover" },
  { id: "playground", label: "Playground" },
  { id: "qualify", label: "Qualify" },
];

/**
 * Dev Tools → LLM Models. The workflow runs left to right:
 * Discover a model → try it in the Playground → Qualify it on the real story pipeline →
 * add it to the Catalog → publish a release (Reference tab) so players can choose it.
 */
export function LlmModelsTab() {
  const [section, setSection] = useState<Section>("catalog");
  // Hand-offs between sections. The nonce lets the same model be sent twice in a row.
  const [playgroundTarget, setPlaygroundTarget] = useState<{ nonce: number; target: TestTarget } | null>(null);
  const [qualifyTarget, setQualifyTarget] = useState<{ nonce: number; target: TestTarget } | null>(null);
  const [catalogPrefill, setCatalogPrefill] = useState<{ nonce: number; draft: CatalogDraft } | null>(null);

  const test = (target: TestTarget) => {
    setPlaygroundTarget({ nonce: Date.now(), target });
    setSection("playground");
  };
  const qualify = (target: TestTarget) => {
    setQualifyTarget({ nonce: Date.now(), target });
    setSection("qualify");
  };
  const add = (draft: CatalogDraft) => {
    setCatalogPrefill({ nonce: Date.now(), draft });
    setSection("catalog");
  };

  // All sections stay mounted (hidden when inactive) so a running qualification or a
  // half-written prompt survives switching between them.
  const visible = (id: Section) => (section === id ? "" : "hidden");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">LLM Models</h2>
        <p className="text-sm text-muted-foreground">
          Manage the story models players can choose. Find a model in Discover, try it in the Playground, prove it on
          the real story pipeline in Qualify, then add it to the Catalog and publish a release.
        </p>
      </div>

      <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
        <TabsList data-testid="tabs-llm-sections">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.id} value={s.id} data-testid={`tab-llm-${s.id}`}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className={visible("catalog")}>
        <CatalogSection prefill={catalogPrefill} onTest={test} onQualify={qualify} />
      </div>
      <div className={visible("discover")}>
        <DiscoverSection onTest={test} onQualify={qualify} onAdd={add} />
      </div>
      <div className={visible("playground")}>
        <PlaygroundSection target={playgroundTarget} />
      </div>
      <div className={visible("qualify")}>
        <QualifySection target={qualifyTarget} />
      </div>
    </div>
  );
}

export default LlmModelsTab;
