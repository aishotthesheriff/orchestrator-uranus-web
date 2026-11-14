/**
 * All repositories, built on one database handle.
 *
 * Import rule: repositories import only server/db, @shared/schema and
 * server/reference/contentTables. Only server/orchestrator/jobService.ts imports the queue.
 */
import type {
  Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate,
  ImagePrompt, InsertImagePrompt, InterviewQuestion, InsertInterviewQuestion,
} from '@shared/schema';
import { pool, type Queryable } from '../db';
import { UserRepository } from './userRepository';
import { GameRepository } from './gameRepository';
import { ContentRepository } from './content/contentRepository';
import { EVENTS, ITEMS, NPC_TEMPLATES, IMAGE_PROMPTS, INTERVIEW_QUESTIONS } from './content/contentFieldMaps';
import { PromptTemplateRepository } from './content/promptTemplateRepository';
import { LlmLogRepository } from './llmLogRepository';
import { ImageCacheRepository } from './imageCacheRepository';
import { ReferenceRepository } from './referenceRepository';
import { JobRepository } from './jobRepository';
import { SettingsRepository } from './settingsRepository';
import { CatalogRepository } from './catalogRepository';
import { PceRepository } from './pceRepository';
import { ManifestRepository } from './manifestRepository';

export function createRepositories(db: Queryable = pool) {
  return {
    users: new UserRepository(db),
    games: new GameRepository(db),
    events: new ContentRepository<Event, InsertEvent>(EVENTS, db),
    items: new ContentRepository<ItemRow, InsertItem>(ITEMS, db),
    npcTemplates: new ContentRepository<NpcTemplate, InsertNpcTemplate>(NPC_TEMPLATES, db),
    imagePrompts: new ContentRepository<ImagePrompt, InsertImagePrompt>(IMAGE_PROMPTS, db),
    interviewQuestions: new ContentRepository<InterviewQuestion, InsertInterviewQuestion>(INTERVIEW_QUESTIONS, db),
    promptTemplates: new PromptTemplateRepository(db),
    llmLogs: new LlmLogRepository(db),
    imageCache: new ImageCacheRepository(db),
    reference: new ReferenceRepository(db),
    jobs: new JobRepository(db),
    settings: new SettingsRepository(db),
    catalog: new CatalogRepository(db),
    pce: new PceRepository(db),
    manifests: new ManifestRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
