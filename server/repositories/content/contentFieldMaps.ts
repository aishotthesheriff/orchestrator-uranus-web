/**
 * Field maps for the content tables. Each entry names the column, whether it holds JSON,
 * and the default applied on create. These reproduce the hand-written storage methods
 * exactly, including `|| null` turning 0 and '' into NULL where the old code did that.
 */
import type {
  InsertEvent, InsertItem, InsertNpcTemplate, InsertImagePrompt, InsertInterviewQuestion, InsertPromptTemplate,
} from '@shared/schema';
import type { FieldMap } from '../sql';
import type { ContentTableConfig } from './contentRepository';

const orNull = (v: unknown) => v || null;
const orDefault = (d: unknown) => (v: unknown) => v ?? d;
const active = { column: 'active', onCreate: orDefault(1) };
const tags = { column: 'tags', json: 'always' as const };
const BY_UPDATED = 'updated_at DESC';

const eventFields: FieldMap<InsertEvent> = {
  name: { column: 'name' },
  segment: { column: 'segment' },
  skill: { column: 'skill' },
  dc: { column: 'dc' },
  triggerCondition: { column: 'trigger_condition', json: 'always' },
  passEffect: { column: 'pass_effect' },
  failEffect: { column: 'fail_effect' },
  tags,
  active,
};

const itemFields: FieldMap<InsertItem> = {
  name: { column: 'name' },
  description: { column: 'description' },
  icon: { column: 'icon' },
  skillBonusSkill: { column: 'skill_bonus_skill', onCreate: orNull },
  skillBonusValue: { column: 'skill_bonus_value', onCreate: orNull },
  sceneEffectTags: { column: 'scene_effect_tags', json: 'nullable' },
  sceneEffectEffect: { column: 'scene_effect_effect', onCreate: orNull },
  efficiency: { column: 'efficiency', json: 'nullable' },
  tags,
  active,
};

const npcTemplateFields: FieldMap<InsertNpcTemplate> = {
  name: { column: 'name' },
  role: { column: 'role' },
  bio: { column: 'bio', onCreate: orNull },
  startingAffinity: { column: 'starting_affinity', onCreate: orDefault(0) },
  tags,
  active,
};

const imagePromptFields: FieldMap<InsertImagePrompt> = {
  name: { column: 'name' },
  promptTemplate: { column: 'prompt_template' },
  inheritVisualStyle: { column: 'inherit_visual_style', onCreate: orDefault(1) },
  size: { column: 'size', onCreate: orDefault('1024x1024') },
  quality: { column: 'quality', onCreate: orDefault('auto') },
  description: { column: 'description', onCreate: orNull },
  sceneTypes: { column: 'scene_types', json: 'always' },
  tags,
  active,
};

const interviewQuestionFields: FieldMap<InsertInterviewQuestion> = {
  question: { column: 'question' },
  variableName: { column: 'variable_name' },
  description: { column: 'description', onCreate: orNull },
  displayOrder: { column: 'display_order', onCreate: orDefault(0) },
  tags,
  active,
};

const promptTemplateFields: FieldMap<InsertPromptTemplate> = {
  name: { column: 'name' },
  content: { column: 'content' },
  systemContent: { column: 'system_content', onCreate: orNull },
  inheritGlobalPrompt: { column: 'inherit_global_prompt', onCreate: orDefault(1) },
  description: { column: 'description', onCreate: orNull },
  version: { column: 'version', onCreate: orDefault(1) },
  active,
};

export const EVENTS: ContentTableConfig<InsertEvent> = { table: 'events', fields: eventFields, orderBy: BY_UPDATED };
export const ITEMS: ContentTableConfig<InsertItem> = { table: 'items', fields: itemFields, orderBy: BY_UPDATED };
export const NPC_TEMPLATES: ContentTableConfig<InsertNpcTemplate> = { table: 'npc_templates', fields: npcTemplateFields, orderBy: BY_UPDATED };
export const IMAGE_PROMPTS: ContentTableConfig<InsertImagePrompt> = { table: 'image_prompts', fields: imagePromptFields, orderBy: BY_UPDATED };
export const INTERVIEW_QUESTIONS: ContentTableConfig<InsertInterviewQuestion> = {
  table: 'interview_questions', fields: interviewQuestionFields, orderBy: 'display_order',
};
export const PROMPT_TEMPLATES: ContentTableConfig<InsertPromptTemplate> = {
  table: 'prompt_templates', fields: promptTemplateFields, orderBy: BY_UPDATED,
};

/** Every content table config, for checks that cover all of them. */
export const CONTENT_CONFIGS = [EVENTS, ITEMS, NPC_TEMPLATES, IMAGE_PROMPTS, INTERVIEW_QUESTIONS, PROMPT_TEMPLATES] as const;
