export type CommunityType = 'projects' | 'issues' | 'discussions' | 'marketplace';

export interface CommunityItem {
  title: string;
  detail: string;
  status: string;
  created_at: string;
  updated_at?: string;
}

export interface CommunityData {
  schema_version: '1.0';
  sync: 'local-only';
  projects: CommunityItem[];
  issues: CommunityItem[];
  discussions: CommunityItem[];
  marketplace: CommunityItem[];
}

export declare class CommunityStore {
  constructor(file: string);
  data: CommunityData;
  load(): Promise<CommunityData>;
  list(): CommunityData;
  add(type: CommunityType, item: { title?: string | undefined; detail?: string | undefined; status?: string | undefined }): Promise<CommunityItem>;
  update(type: CommunityType, index: number, item: { title?: string | undefined; detail?: string | undefined }): Promise<CommunityItem>;
  remove(type: CommunityType, index: number): Promise<CommunityItem>;
}