export type FileType = "image" | "pdf";
export type LinkMode = "anyone" | "email";
export type ShareStatus = "active" | "expired" | "deleted";
export type Decision = "pending" | "approved" | "rejected";
export type AuthorType = "sender" | "recipient";

export interface Share {
  id: string;
  owner_id: string;
  token: string;
  original_filename: string;
  mime_type: string;
  file_type: FileType;
  storage_key: string;
  file_size_bytes: number;
  link_mode: LinkMode;
  recipient_email: string | null; // deprecated - see ShareRecipient / the share_recipients table
  expires_at: string | null;
  max_views: number | null;
  view_count: number;
  status: ShareStatus;
  decision: Decision;
  require_decision: boolean;
  folder_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface ShareView {
  id: string;
  share_id: string;
  viewer_identity: string;
  viewer_ip: string | null;
  user_agent: string | null;
  duration_seconds: number;
  viewed_at: string;
}

export interface ShareRecipient {
  id: string;
  share_id: string;
  email: string;
  created_at: string;
}

export interface Folder {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface ShareComment {
  id: string;
  share_id: string;
  author_type: AuthorType;
  author_name: string;
  body: string;
  created_at: string;
}
