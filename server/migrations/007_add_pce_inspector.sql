-- PCE Inspector Tables Migration

-- Test scenarios (reusable test cases)
CREATE TABLE IF NOT EXISTS pce_test_scenarios (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  description TEXT,

  -- Game state snapshot
  game_state_json TEXT NOT NULL,
  player_action TEXT NOT NULL,
  checks_json TEXT DEFAULT '[]',
  triggered_event_json TEXT,

  -- User preferences
  theme TEXT,
  style TEXT,
  image_model_key TEXT,

  -- Organization
  tags TEXT,
  is_preset INTEGER DEFAULT 0,

  -- Metadata
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Test runs (execution results)
CREATE TABLE IF NOT EXISTS pce_test_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  scenario_id TEXT NOT NULL,

  -- Template versions used (for tracking)
  release_version TEXT,
  template_master_id TEXT,
  template_narrative_id TEXT,
  template_image_id TEXT,
  template_actions_id TEXT,

  -- Execution results
  status TEXT CHECK(status IN ('success', 'partial_success', 'failure')),
  stage_results_json TEXT NOT NULL,

  -- Performance metadata
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  duration_ms INTEGER,
  total_tokens_prompt INTEGER,
  total_tokens_response INTEGER,
  estimated_cost_usd REAL,

  -- User annotations
  notes TEXT,
  tags TEXT,
  starred INTEGER DEFAULT 0,

  FOREIGN KEY (scenario_id) REFERENCES pce_test_scenarios(id) ON DELETE CASCADE
);

-- Test metrics (quality analysis - Phase 5 feature)
CREATE TABLE IF NOT EXISTS pce_test_metrics (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  test_run_id TEXT NOT NULL,

  -- Overall score
  overall_score INTEGER NOT NULL CHECK(overall_score >= 0 AND overall_score <= 100),

  -- Category scores
  coherence_score INTEGER,
  thematic_score INTEGER,
  variety_score INTEGER,
  technical_score INTEGER,
  player_impact_score INTEGER,

  -- Detailed analysis (JSON blobs)
  coherence_analysis_json TEXT,
  thematic_analysis_json TEXT,
  variety_analysis_json TEXT,
  technical_analysis_json TEXT,
  player_impact_analysis_json TEXT,

  -- Metadata
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  computation_duration_ms INTEGER,

  FOREIGN KEY (test_run_id) REFERENCES pce_test_runs(id) ON DELETE CASCADE
);

-- Template versions (track changes to prompts)
CREATE TABLE IF NOT EXISTS pce_template_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  prompt_id TEXT NOT NULL,

  -- Version info
  version_number INTEGER NOT NULL,
  release_version TEXT,

  -- Content snapshot
  system_content TEXT,
  content TEXT,

  -- Metadata
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,

  FOREIGN KEY (prompt_id) REFERENCES prompt_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (release_version) REFERENCES reference_releases(version)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_test_scenarios_tags ON pce_test_scenarios(tags);
CREATE INDEX IF NOT EXISTS idx_test_scenarios_is_preset ON pce_test_scenarios(is_preset);
CREATE INDEX IF NOT EXISTS idx_test_scenarios_created_at ON pce_test_scenarios(created_at);

CREATE INDEX IF NOT EXISTS idx_test_runs_scenario ON pce_test_runs(scenario_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_executed_at ON pce_test_runs(executed_at);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON pce_test_runs(status);
CREATE INDEX IF NOT EXISTS idx_test_runs_starred ON pce_test_runs(starred);
CREATE INDEX IF NOT EXISTS idx_test_runs_release_version ON pce_test_runs(release_version);

CREATE INDEX IF NOT EXISTS idx_test_metrics_run ON pce_test_metrics(test_run_id);

CREATE INDEX IF NOT EXISTS idx_template_versions_prompt ON pce_template_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_template_versions_release ON pce_template_versions(release_version);

-- Add status tracking to prompt_templates table (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='prompt_templates' AND column_name='status'
  ) THEN
    ALTER TABLE prompt_templates ADD COLUMN status TEXT DEFAULT 'active' 
      CHECK(status IN ('draft', 'testing', 'ready', 'active', 'archived'));
    
    CREATE INDEX IF NOT EXISTS idx_prompts_status ON prompt_templates(status);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='prompt_templates' AND column_name='quality_score'
  ) THEN
    ALTER TABLE prompt_templates ADD COLUMN quality_score INTEGER;
    ALTER TABLE prompt_templates ADD COLUMN last_tested_at TIMESTAMPTZ;
  END IF;
END $$;

-- Insert preset scenarios
INSERT INTO pce_test_scenarios (id, name, description, game_state_json, player_action, checks_json, triggered_event_json, theme, style, image_model_key, tags, is_preset, created_by)
VALUES 
  (
    'preset-fresh-start',
    '🚀 Fresh Start',
    'Turn 1, full resources, intro sequence',
    '{"turnNumber":1,"day":1,"segment":"morning","hull":100,"crew":[],"inventory":[],"skills":{"navigation":0,"combat":0,"engineering":0,"science":0,"diplomacy":0}}',
    'Look around and assess the situation',
    '[]',
    NULL,
    NULL,
    NULL,
    NULL,
    'preset,intro,turn1',
    1,
    'system'
  ),
  (
    'preset-combat',
    '⚔️ Combat Situation',
    'Mid-game combat encounter',
    '{"turnNumber":15,"day":3,"segment":"afternoon","hull":65,"crew":[{"name":"Security Officer","skill":"combat"}],"inventory":["blaster","medkit"],"skills":{"navigation":5,"combat":8,"engineering":3,"science":4,"diplomacy":2}}',
    'Fire at the hostile entity',
    '[{"skill":"combat","difficulty":12,"result":"success"}]',
    '{"name":"hostile_encounter","segment":"afternoon","skill":"combat"}',
    NULL,
    NULL,
    NULL,
    'preset,combat,mid-game',
    1,
    'system'
  ),
  (
    'preset-crisis',
    '😰 Crisis Mode',
    'Low hull, desperate situation',
    '{"turnNumber":30,"day":6,"segment":"evening","hull":15,"crew":[],"inventory":["broken_scanner","emergency_rations"],"skills":{"navigation":6,"combat":3,"engineering":7,"science":5,"diplomacy":4}}',
    'Attempt emergency repairs',
    '[{"skill":"engineering","difficulty":15,"result":"partial"}]',
    NULL,
    NULL,
    NULL,
    NULL,
    'preset,crisis,low-hull',
    1,
    'system'
  ),
  (
    'preset-late-game',
    '🎯 Late Game',
    'Near end of journey, complex state',
    '{"turnNumber":50,"day":10,"segment":"night","hull":45,"crew":[{"name":"Navigator","skill":"piloting"},{"name":"Engineer","skill":"engineering"}],"inventory":["advanced_scanner","repair_kit","alien_artifact"],"skills":{"navigation":9,"combat":6,"engineering":8,"science":10,"diplomacy":7}}',
    'Analyze the alien artifact',
    '[{"skill":"science","difficulty":18,"result":"success"}]',
    '{"name":"artifact_discovery","segment":"night","skill":"science"}',
    NULL,
    NULL,
    NULL,
    'preset,late-game,complex',
    1,
    'system'
  )
ON CONFLICT (id) DO NOTHING;

-- Create view for easy scenario browsing
CREATE OR REPLACE VIEW pce_scenario_summary AS
SELECT 
  s.id,
  s.name,
  s.description,
  s.is_preset,
  s.tags,
  s.created_at,
  COUNT(r.id) as test_run_count,
  MAX(r.executed_at) as last_tested_at
FROM pce_test_scenarios s
LEFT JOIN pce_test_runs r ON s.id = r.scenario_id
GROUP BY s.id, s.name, s.description, s.is_preset, s.tags, s.created_at;
