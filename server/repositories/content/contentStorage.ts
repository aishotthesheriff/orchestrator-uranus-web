import type {
  PromptTemplate, InsertPromptTemplate, Event, InsertEvent, ItemRow, InsertItem, NpcTemplate, InsertNpcTemplate,
  ImagePrompt, InsertImagePrompt, InterviewQuestion, InsertInterviewQuestion,
} from '@shared/schema';

/**
 * The content-table methods the storage facade exposes, under their historical names.
 * Each one maps onto a ContentRepository method (list, listActive, getById, create, update)
 * or a PromptTemplateRepository lookup.
 */
export interface IContentStorage {
  getPromptTemplate(name: string): Promise<PromptTemplate | undefined>;
  getAllPromptTemplates(): Promise<PromptTemplate[]>;
  getActivePromptTemplates(): Promise<PromptTemplate[]>;
  getActivePromptTemplate(name: string): Promise<PromptTemplate | undefined>;
  createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(id: string, template: Partial<InsertPromptTemplate>): Promise<PromptTemplate>;
  getAllEvents(): Promise<Event[]>;
  getActiveEvents(): Promise<Event[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: string, event: Partial<InsertEvent>): Promise<Event>;
  getItems(): Promise<ItemRow[]>;
  getActiveItems(): Promise<ItemRow[]>;
  getItem(id: string): Promise<ItemRow | undefined>;
  createItem(item: InsertItem): Promise<ItemRow>;
  updateItem(id: string, item: Partial<InsertItem>): Promise<ItemRow>;
  getNpcTemplates(): Promise<NpcTemplate[]>;
  getActiveNpcTemplates(): Promise<NpcTemplate[]>;
  createNpcTemplate(npc: InsertNpcTemplate): Promise<NpcTemplate>;
  updateNpcTemplate(id: string, npc: Partial<InsertNpcTemplate>): Promise<NpcTemplate>;
  getImagePrompts(): Promise<ImagePrompt[]>;
  getActiveImagePrompts(): Promise<ImagePrompt[]>;
  createImagePrompt(prompt: InsertImagePrompt): Promise<ImagePrompt>;
  updateImagePrompt(id: string, prompt: Partial<InsertImagePrompt>): Promise<ImagePrompt>;
  getInterviewQuestions(): Promise<InterviewQuestion[]>;
  getActiveInterviewQuestions(): Promise<InterviewQuestion[]>;
  createInterviewQuestion(question: InsertInterviewQuestion): Promise<InterviewQuestion>;
  updateInterviewQuestion(id: string, question: Partial<InsertInterviewQuestion>): Promise<InterviewQuestion>;
}
