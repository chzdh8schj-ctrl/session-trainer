export type Subject = {
  id: string;
  name: string;
  created_at: string;
  tickets_count: number;
  parts_count: number;
};

export type Part = {
  id: string;
  ticket_id: string;
  title: string;
  question: string;
  options: string[];
  correct_index: number;
  note: string;
  position: number;
};

export type Ticket = {
  id: string;
  subject_id: string;
  title: string;
  question: string;
  position: number;
  created_at: string;
  parts: Part[];
};

export type AiStatus = 'ok' | 'manual' | 'budget' | 'error';

export type TicketWithAi = Ticket & {
  ai_status: AiStatus;
  ai_error?: string;
};

export type AnswerResult = {
  correct: boolean;
  correct_index: number;
  note: string;
};

export type Usage = {
  month: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_rub: number;
  limit_rub: number;
  left_rub: number;
  ai_enabled: boolean;
};

export type Settings = {
  monthly_limit_rub: number;
  ai_enabled: boolean;
};

export type PartPayload = {
  title: string;
  question: string;
  options: string[];
  correct_index: number;
  note: string;
};

export type BackupPart = {
  title: string;
  question: string;
  options: string[];
  correct_index: number;
  note: string;
};

export type BackupTicket = {
  title: string;
  question: string;
  parts: BackupPart[];
};

export type BackupSubject = {
  name: string;
  tickets: BackupTicket[];
};

export type Backup = {
  version: number;
  exported_at: string;
  subjects: BackupSubject[];
};

export type ImportResult = {
  subjects_created: number;
  tickets_created: number;
  parts_created: number;
};
