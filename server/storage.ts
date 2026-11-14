/**
 * The storage facade. Every method delegates to a repository in server/repositories/.
 * Existing code imports `storage` and keeps working; new code may use `storage.repos.*`.
 * Delegates are instance properties, so vi.spyOn(storage, ...) works on them.
 */
export type { UserPreferences } from './repositories/userRepository';
import { createRepositories, type Repositories } from './repositories';
import type { IContentStorage } from './repositories/content/contentStorage';
import type { IUserRepository } from './repositories/userRepository';
import type { IGameRepository } from './repositories/gameRepository';
import type { ILlmLogRepository } from './repositories/llmLogRepository';
import type { IImageCacheRepository } from './repositories/imageCacheRepository';
import type { IReferenceRepository } from './repositories/referenceRepository';
import type { IJobRepository } from './repositories/jobRepository';
import type { ISettingsRepository } from './repositories/settingsRepository';
import type { ICatalogRepository } from './repositories/catalogRepository';
import type { IPceRepository } from './repositories/pceRepository';
import type { IManifestRepository } from './repositories/manifestRepository';

export interface IStorage extends
  IUserRepository,
  IGameRepository,
  ILlmLogRepository,
  IImageCacheRepository,
  IReferenceRepository,
  IJobRepository,
  ISettingsRepository,
  ICatalogRepository,
  IPceRepository,
  IManifestRepository,
  IContentStorage {}

export class DatabaseStorage implements IStorage {
  readonly repos: Repositories = createRepositories();

  getUser: IStorage['getUser'] = (...a) => this.repos.users.getUser(...a);
  getUserByUsername: IStorage['getUserByUsername'] = (...a) => this.repos.users.getUserByUsername(...a);
  searchUsersByUsername: IStorage['searchUsersByUsername'] = (...a) => this.repos.users.searchUsersByUsername(...a);
  ensureUser: IStorage['ensureUser'] = (...a) => this.repos.users.ensureUser(...a);
  createUser: IStorage['createUser'] = (...a) => this.repos.users.createUser(...a);
  getUserPreferences: IStorage['getUserPreferences'] = (...a) => this.repos.users.getUserPreferences(...a);
  updateUserPreferences: IStorage['updateUserPreferences'] = (...a) => this.repos.users.updateUserPreferences(...a);
  getGameState: IStorage['getGameState'] = (...a) => this.repos.games.getGameState(...a);
  getGamesByUsername: IStorage['getGamesByUsername'] = (...a) => this.repos.games.getGamesByUsername(...a);
  getGameSummariesByUsername: IStorage['getGameSummariesByUsername'] = (...a) => this.repos.games.getGameSummariesByUsername(...a);
  getGameSummariesByUsernames: IStorage['getGameSummariesByUsernames'] = (...a) => this.repos.games.getGameSummariesByUsernames(...a);
  createGameState: IStorage['createGameState'] = (...a) => this.repos.games.createGameState(...a);
  deleteGameState: IStorage['deleteGameState'] = (...a) => this.repos.games.deleteGameState(...a);
  processTurnWithTransaction: IStorage['processTurnWithTransaction'] = (...a) => this.repos.games.processTurnWithTransaction(...a);
  getPromptTemplate: IStorage['getPromptTemplate'] = (...a) => this.repos.promptTemplates.getByName(...a);
  getAllPromptTemplates: IStorage['getAllPromptTemplates'] = (...a) => this.repos.promptTemplates.list(...a);
  getActivePromptTemplates: IStorage['getActivePromptTemplates'] = (...a) => this.repos.promptTemplates.listActive(...a);
  getActivePromptTemplate: IStorage['getActivePromptTemplate'] = (...a) => this.repos.promptTemplates.getActiveByName(...a);
  createPromptTemplate: IStorage['createPromptTemplate'] = (...a) => this.repos.promptTemplates.create(...a);
  updatePromptTemplate: IStorage['updatePromptTemplate'] = (...a) => this.repos.promptTemplates.update(...a);
  createLlmLog: IStorage['createLlmLog'] = (...a) => this.repos.llmLogs.createLlmLog(...a);
  getLlmLogs: IStorage['getLlmLogs'] = (...a) => this.repos.llmLogs.getLlmLogs(...a);
  clearAllLlmLogs: IStorage['clearAllLlmLogs'] = (...a) => this.repos.llmLogs.clearAllLlmLogs(...a);
  getAllEvents: IStorage['getAllEvents'] = (...a) => this.repos.events.list(...a);
  getActiveEvents: IStorage['getActiveEvents'] = (...a) => this.repos.events.listActive(...a);
  createEvent: IStorage['createEvent'] = (...a) => this.repos.events.create(...a);
  updateEvent: IStorage['updateEvent'] = (...a) => this.repos.events.update(...a);
  getItems: IStorage['getItems'] = (...a) => this.repos.items.list(...a);
  getActiveItems: IStorage['getActiveItems'] = (...a) => this.repos.items.listActive(...a);
  getItem: IStorage['getItem'] = (...a) => this.repos.items.getById(...a);
  createItem: IStorage['createItem'] = (...a) => this.repos.items.create(...a);
  updateItem: IStorage['updateItem'] = (...a) => this.repos.items.update(...a);
  getNpcTemplates: IStorage['getNpcTemplates'] = (...a) => this.repos.npcTemplates.list(...a);
  getActiveNpcTemplates: IStorage['getActiveNpcTemplates'] = (...a) => this.repos.npcTemplates.listActive(...a);
  createNpcTemplate: IStorage['createNpcTemplate'] = (...a) => this.repos.npcTemplates.create(...a);
  updateNpcTemplate: IStorage['updateNpcTemplate'] = (...a) => this.repos.npcTemplates.update(...a);
  getImagePrompts: IStorage['getImagePrompts'] = (...a) => this.repos.imagePrompts.list(...a);
  getActiveImagePrompts: IStorage['getActiveImagePrompts'] = (...a) => this.repos.imagePrompts.listActive(...a);
  createImagePrompt: IStorage['createImagePrompt'] = (...a) => this.repos.imagePrompts.create(...a);
  updateImagePrompt: IStorage['updateImagePrompt'] = (...a) => this.repos.imagePrompts.update(...a);
  getInterviewQuestions: IStorage['getInterviewQuestions'] = (...a) => this.repos.interviewQuestions.list(...a);
  getActiveInterviewQuestions: IStorage['getActiveInterviewQuestions'] = (...a) => this.repos.interviewQuestions.listActive(...a);
  createInterviewQuestion: IStorage['createInterviewQuestion'] = (...a) => this.repos.interviewQuestions.create(...a);
  updateInterviewQuestion: IStorage['updateInterviewQuestion'] = (...a) => this.repos.interviewQuestions.update(...a);
  createGeneratedImage: IStorage['createGeneratedImage'] = (...a) => this.repos.imageCache.createGeneratedImage(...a);
  getGeneratedImage: IStorage['getGeneratedImage'] = (...a) => this.repos.imageCache.getGeneratedImage(...a);
  getGeneratedImageByHash: IStorage['getGeneratedImageByHash'] = (...a) => this.repos.imageCache.getGeneratedImageByHash(...a);
  getGeneratedImagesByTemplate: IStorage['getGeneratedImagesByTemplate'] = (...a) => this.repos.imageCache.getGeneratedImagesByTemplate(...a);
  getAllGeneratedImages: IStorage['getAllGeneratedImages'] = (...a) => this.repos.imageCache.getAllGeneratedImages(...a);
  updateImageAccess: IStorage['updateImageAccess'] = (...a) => this.repos.imageCache.updateImageAccess(...a);
  deleteGeneratedImage: IStorage['deleteGeneratedImage'] = (...a) => this.repos.imageCache.deleteGeneratedImage(...a);
  deleteGeneratedImages: IStorage['deleteGeneratedImages'] = (...a) => this.repos.imageCache.deleteGeneratedImages(...a);
  getImageCacheStats: IStorage['getImageCacheStats'] = (...a) => this.repos.imageCache.getImageCacheStats(...a);
  createReferenceRelease: IStorage['createReferenceRelease'] = (...a) => this.repos.reference.createReferenceRelease(...a);
  getReferenceRelease: IStorage['getReferenceRelease'] = (...a) => this.repos.reference.getReferenceRelease(...a);
  getCurrentReferenceRelease: IStorage['getCurrentReferenceRelease'] = (...a) => this.repos.reference.getCurrentReferenceRelease(...a);
  getAllReferenceReleases: IStorage['getAllReferenceReleases'] = (...a) => this.repos.reference.getAllReferenceReleases(...a);
  updateReferenceRelease: IStorage['updateReferenceRelease'] = (...a) => this.repos.reference.updateReferenceRelease(...a);
  setCurrentReferenceRelease: IStorage['setCurrentReferenceRelease'] = (...a) => this.repos.reference.setCurrentReferenceRelease(...a);
  dumpContentTable: IStorage['dumpContentTable'] = (...a) => this.repos.reference.dumpContentTable(...a);
  getImageJob: IStorage['getImageJob'] = (...a) => this.repos.jobs.getImageJob(...a);
  countPendingJobs: IStorage['countPendingJobs'] = (...a) => this.repos.jobs.countPendingJobs(...a);
  updateImageJob: IStorage['updateImageJob'] = (...a) => this.repos.jobs.updateImageJob(...a);
  getTurnJob: IStorage['getTurnJob'] = (...a) => this.repos.jobs.getTurnJob(...a);
  updateTurnJob: IStorage['updateTurnJob'] = (...a) => this.repos.jobs.updateTurnJob(...a);
  getAllSettings: IStorage['getAllSettings'] = (...a) => this.repos.settings.getAllSettings(...a);
  getActiveSettings: IStorage['getActiveSettings'] = (...a) => this.repos.settings.getActiveSettings(...a);
  getSetting: IStorage['getSetting'] = (...a) => this.repos.settings.getSetting(...a);
  upsertSetting: IStorage['upsertSetting'] = (...a) => this.repos.settings.upsertSetting(...a);
  getActiveImageModels: IStorage['getActiveImageModels'] = (...a) => this.repos.catalog.getActiveImageModels(...a);
  getImageModelByKey: IStorage['getImageModelByKey'] = (...a) => this.repos.catalog.getImageModelByKey(...a);
  getDefaultImageModel: IStorage['getDefaultImageModel'] = (...a) => this.repos.catalog.getDefaultImageModel(...a);
  listImageModels: IStorage['listImageModels'] = (...a) => this.repos.catalog.listImageModels(...a);
  upsertImageModel: IStorage['upsertImageModel'] = (...a) => this.repos.catalog.upsertImageModel(...a);
  deactivateImageModel: IStorage['deactivateImageModel'] = (...a) => this.repos.catalog.deactivateImageModel(...a);
  reorderImageModels: IStorage['reorderImageModels'] = (...a) => this.repos.catalog.reorderImageModels(...a);
  listLlmModels: IStorage['listLlmModels'] = (...a) => this.repos.catalog.listLlmModels(...a);
  getActiveLlmModels: IStorage['getActiveLlmModels'] = (...a) => this.repos.catalog.getActiveLlmModels(...a);
  getLlmModelByKey: IStorage['getLlmModelByKey'] = (...a) => this.repos.catalog.getLlmModelByKey(...a);
  getDefaultLlmModel: IStorage['getDefaultLlmModel'] = (...a) => this.repos.catalog.getDefaultLlmModel(...a);
  upsertLlmModel: IStorage['upsertLlmModel'] = (...a) => this.repos.catalog.upsertLlmModel(...a);
  deactivateLlmModel: IStorage['deactivateLlmModel'] = (...a) => this.repos.catalog.deactivateLlmModel(...a);
  recordLlmModelCheck: IStorage['recordLlmModelCheck'] = (...a) => this.repos.catalog.recordLlmModelCheck(...a);
  listStoryThemes: IStorage['listStoryThemes'] = (...a) => this.repos.catalog.listStoryThemes(...a);
  getActiveStoryThemes: IStorage['getActiveStoryThemes'] = (...a) => this.repos.catalog.getActiveStoryThemes(...a);
  upsertStoryTheme: IStorage['upsertStoryTheme'] = (...a) => this.repos.catalog.upsertStoryTheme(...a);
  getDefaultStoryTheme: IStorage['getDefaultStoryTheme'] = (...a) => this.repos.catalog.getDefaultStoryTheme(...a);
  deactivateStoryTheme: IStorage['deactivateStoryTheme'] = (...a) => this.repos.catalog.deactivateStoryTheme(...a);
  listVisualStyles: IStorage['listVisualStyles'] = (...a) => this.repos.catalog.listVisualStyles(...a);
  getActiveVisualStyles: IStorage['getActiveVisualStyles'] = (...a) => this.repos.catalog.getActiveVisualStyles(...a);
  upsertVisualStyle: IStorage['upsertVisualStyle'] = (...a) => this.repos.catalog.upsertVisualStyle(...a);
  getDefaultVisualStyle: IStorage['getDefaultVisualStyle'] = (...a) => this.repos.catalog.getDefaultVisualStyle(...a);
  deactivateVisualStyle: IStorage['deactivateVisualStyle'] = (...a) => this.repos.catalog.deactivateVisualStyle(...a);
  getPceTestScenarios: IStorage['getPceTestScenarios'] = (...a) => this.repos.pce.getPceTestScenarios(...a);
  getPceTestScenario: IStorage['getPceTestScenario'] = (...a) => this.repos.pce.getPceTestScenario(...a);
  createPceTestScenario: IStorage['createPceTestScenario'] = (...a) => this.repos.pce.createPceTestScenario(...a);
  updatePceTestScenario: IStorage['updatePceTestScenario'] = (...a) => this.repos.pce.updatePceTestScenario(...a);
  deletePceTestScenario: IStorage['deletePceTestScenario'] = (...a) => this.repos.pce.deletePceTestScenario(...a);
  getPceTestRuns: IStorage['getPceTestRuns'] = (...a) => this.repos.pce.getPceTestRuns(...a);
  getPceTestRun: IStorage['getPceTestRun'] = (...a) => this.repos.pce.getPceTestRun(...a);
  createPceTestRun: IStorage['createPceTestRun'] = (...a) => this.repos.pce.createPceTestRun(...a);
  updatePceTestRun: IStorage['updatePceTestRun'] = (...a) => this.repos.pce.updatePceTestRun(...a);
  deletePceTestRun: IStorage['deletePceTestRun'] = (...a) => this.repos.pce.deletePceTestRun(...a);
  getPceTestMetrics: IStorage['getPceTestMetrics'] = (...a) => this.repos.pce.getPceTestMetrics(...a);
  getPceTemplateVersions: IStorage['getPceTemplateVersions'] = (...a) => this.repos.pce.getPceTemplateVersions(...a);
  getTurnExecutionManifest: IStorage['getTurnExecutionManifest'] = (...a) => this.repos.manifests.getTurnExecutionManifest(...a);
  getGameManifests: IStorage['getGameManifests'] = (...a) => this.repos.manifests.getGameManifests(...a);
}

export const storage = new DatabaseStorage();
