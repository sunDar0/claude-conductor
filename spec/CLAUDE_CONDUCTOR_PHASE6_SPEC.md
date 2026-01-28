# Claude Conductor - Phase 6 상세 구현 스펙

> **목표**: 알림 및 외부 연동 - Slack, Discord, GitHub, Linear, Webhook
> **예상 소요**: 2주
> **선행 조건**: Phase 5 완료

---

## 📋 구현 체크리스트

- [ ] Notification Hub (알림 허브)
- [ ] Slack 연동 (Webhook + Bot)
- [ ] Discord 연동 (Webhook)
- [ ] Email 연동 (SMTP)
- [ ] GitHub 연동 (PR, Issue, Comment)
- [ ] Linear 연동 (Issue 동기화)
- [ ] 범용 Webhook 시스템
- [ ] 알림 템플릿 시스템
- [ ] MCP 도구

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Claude Conductor                                 │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Event Sources (이벤트 소스)                     │  │
│  │                                                                    │  │
│  │   task.*        server.*       review.*       agent.*             │  │
│  │   (태스크)       (서버)         (리뷰)         (에이전트)           │  │
│  └────────────────────────────┬─────────────────────────────────────┘  │
│                               │                                        │
│                               ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Notification Hub (알림 허브)                    │  │
│  │                                                                    │  │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐                 │  │
│  │   │  Router    │  │  Template  │  │   Queue    │                 │  │
│  │   │ (라우팅)   │  │  (템플릿)   │  │   (큐)     │                 │  │
│  │   └────────────┘  └────────────┘  └────────────┘                 │  │
│  └────────────────────────────┬─────────────────────────────────────┘  │
│                               │                                        │
│       ┌───────────────────────┼───────────────────────┐               │
│       │           │           │           │           │               │
│       ▼           ▼           ▼           ▼           ▼               │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│  │ Slack  │ │Discord │ │ Email  │ │ GitHub │ │Webhook │              │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘              │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: 디렉토리 구조 확장

```
conductor-mcp/services/conductor/
└── src/
    ├── notifications/              # 알림 시스템
    │   ├── index.ts
    │   ├── hub.ts                  # 알림 허브
    │   ├── queue.ts                # 알림 큐
    │   ├── templates.ts            # 템플릿 엔진
    │   └── providers/
    │       ├── base.ts
    │       ├── slack.ts
    │       ├── discord.ts
    │       ├── email.ts
    │       └── webhook.ts
    │
    ├── integrations/               # 외부 서비스 연동
    │   ├── github/
    │   │   ├── client.ts
    │   │   ├── pr.ts
    │   │   └── issue.ts
    │   └── linear/
    │       ├── client.ts
    │       └── sync.ts
    │
    └── handlers/
        ├── notification.handlers.ts
        ├── github.handlers.ts
        └── webhook.handlers.ts

.claude/
└── notifications/
    ├── config.yaml                 # 알림 설정
    └── templates/
        ├── task-created.md
        ├── task-review.md
        └── agent-error.md
```

---

## Step 2: 타입 정의

### 파일: `src/types/notification.types.ts`

```typescript
// ===========================================
// 알림 관련 타입 정의
// ===========================================

export type NotificationChannel = 'slack' | 'discord' | 'email' | 'webhook';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface NotificationEvent {
  type: string;                    // 'task.created', 'review.requested'
  source: string;
  payload: Record<string, any>;
  timestamp: string;
  task_id?: string;
  agent_id?: string;
}

export interface NotificationMessage {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  priority: NotificationPriority;
  rendered: {
    title?: string;
    body: string;
    blocks?: any[];                // Slack Block Kit
    embeds?: any[];                // Discord Embeds
  };
  recipients?: string[];
  status: NotificationStatus;
  created_at: string;
  sent_at?: string;
  error?: string;
  retries: number;
}

// ===========================================
// 채널 설정
// ===========================================

export interface NotificationConfig {
  enabled: boolean;
  channels: {
    slack?: SlackConfig;
    discord?: DiscordConfig;
    email?: EmailConfig;
    webhooks?: WebhookConfig[];
  };
  rules: NotificationRule[];
  defaults: {
    priority: NotificationPriority;
    retry_count: number;
    retry_delay_ms: number;
  };
}

export interface SlackConfig {
  enabled: boolean;
  webhook_url?: string;
  bot_token?: string;
  default_channel: string;
  username?: string;
  icon_emoji?: string;
}

export interface DiscordConfig {
  enabled: boolean;
  webhook_url: string;
  username?: string;
  avatar_url?: string;
}

export interface EmailConfig {
  enabled: boolean;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  from: string;
  default_to: string[];
}

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  events: string[];
  secret?: string;
  enabled: boolean;
}

// ===========================================
// 라우팅 규칙
// ===========================================

export interface NotificationRule {
  id: string;
  name: string;
  event_pattern: string;           // 'task.*', 'review.requested'
  conditions?: RuleCondition[];
  channels: NotificationChannel[];
  priority?: NotificationPriority;
  template?: string;
  enabled: boolean;
}

export interface RuleCondition {
  field: string;
  operator: 'eq' | 'ne' | 'in' | 'contains' | 'gt' | 'lt';
  value: any;
}

// ===========================================
// GitHub 연동
// ===========================================

export interface GitHubConfig {
  enabled: boolean;
  token: string;
  owner: string;
  repo: string;
  auto_pr: boolean;
  auto_issue: boolean;
  label_prefix: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  head: string;
  base: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  labels: string[];
}

// ===========================================
// Linear 연동
// ===========================================

export interface LinearConfig {
  enabled: boolean;
  api_key: string;
  team_id: string;
  project_id?: string;
  status_map: Record<string, string>;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: string;
}
```

---

## Step 3: 알림 허브

### 파일: `src/notifications/hub.ts`

```typescript
import { EventEmitter } from 'events';
import { minimatch } from 'minimatch';
import { v4 as uuid } from 'uuid';
import type {
  NotificationEvent,
  NotificationMessage,
  NotificationConfig,
  NotificationChannel,
  NotificationRule,
} from '../types/notification.types';
import { NotificationQueue } from './queue';
import { TemplateEngine } from './templates';
import { SlackProvider } from './providers/slack';
import { DiscordProvider } from './providers/discord';
import { EmailProvider } from './providers/email';
import { WebhookProvider } from './providers/webhook';

type Provider = SlackProvider | DiscordProvider | EmailProvider | WebhookProvider;

export class NotificationHub extends EventEmitter {
  private config: NotificationConfig;
  private queue: NotificationQueue;
  private templates: TemplateEngine;
  private providers: Map<string, Provider> = new Map();
  private processing: boolean = false;

  constructor(config: NotificationConfig) {
    super();
    this.config = config;
    this.queue = new NotificationQueue();
    this.templates = new TemplateEngine();
    
    this.initializeProviders();
  }

  // ===========================================
  // 초기화
  // ===========================================
  private initializeProviders(): void {
    const { channels } = this.config;

    if (channels.slack?.enabled) {
      this.providers.set('slack', new SlackProvider(channels.slack));
      console.log('[NotificationHub] Slack provider initialized');
    }

    if (channels.discord?.enabled) {
      this.providers.set('discord', new DiscordProvider(channels.discord));
      console.log('[NotificationHub] Discord provider initialized');
    }

    if (channels.email?.enabled) {
      this.providers.set('email', new EmailProvider(channels.email));
      console.log('[NotificationHub] Email provider initialized');
    }

    if (channels.webhooks) {
      for (const webhook of channels.webhooks) {
        if (webhook.enabled) {
          this.providers.set(`webhook:${webhook.id}`, new WebhookProvider(webhook));
        }
      }
    }
  }

  // ===========================================
  // 알림 발송
  // ===========================================
  async notify(event: NotificationEvent): Promise<void> {
    if (!this.config.enabled) return;

    console.log(`[NotificationHub] Processing: ${event.type}`);

    // 매칭 규칙 찾기
    const rules = this.findMatchingRules(event);
    if (rules.length === 0) return;

    // 알림 메시지 생성 및 큐잉
    for (const rule of rules) {
      for (const channel of rule.channels) {
        const provider = this.providers.get(channel);
        if (!provider) continue;

        try {
          const message = await this.createMessage(event, channel, rule);
          this.queue.enqueue(message);
        } catch (error) {
          console.error(`[NotificationHub] Create message error:`, error);
        }
      }
    }

    this.processQueue();
  }

  private findMatchingRules(event: NotificationEvent): NotificationRule[] {
    return this.config.rules.filter(rule => {
      if (!rule.enabled) return false;
      if (!minimatch(event.type, rule.event_pattern)) return false;

      if (rule.conditions) {
        for (const cond of rule.conditions) {
          if (!this.evaluateCondition(event, cond)) return false;
        }
      }
      return true;
    });
  }

  private evaluateCondition(event: NotificationEvent, cond: RuleCondition): boolean {
    const value = cond.field.split('.').reduce((o: any, k) => o?.[k], event);
    
    switch (cond.operator) {
      case 'eq': return value === cond.value;
      case 'ne': return value !== cond.value;
      case 'in': return Array.isArray(cond.value) && cond.value.includes(value);
      case 'contains': return String(value).includes(cond.value);
      case 'gt': return value > cond.value;
      case 'lt': return value < cond.value;
      default: return false;
    }
  }

  // ===========================================
  // 메시지 생성
  // ===========================================
  private async createMessage(
    event: NotificationEvent,
    channel: NotificationChannel,
    rule: NotificationRule
  ): Promise<NotificationMessage> {
    const templateName = rule.template || event.type.replace(/\./g, '-');
    const rendered = await this.templates.render(templateName, channel, {
      ...event.payload,
      event_type: event.type,
      task_id: event.task_id,
      timestamp: event.timestamp,
    });

    return {
      id: `notif-${Date.now()}-${uuid().slice(0, 8)}`,
      event,
      channel,
      priority: rule.priority || this.config.defaults.priority,
      rendered,
      status: 'pending',
      created_at: new Date().toISOString(),
      retries: 0,
    };
  }

  // ===========================================
  // 큐 처리
  // ===========================================
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const message = this.queue.dequeue();
        if (!message) break;

        await this.sendMessage(message);
        await new Promise(r => setTimeout(r, 100)); // Rate limit
      }
    } finally {
      this.processing = false;
    }
  }

  private async sendMessage(message: NotificationMessage): Promise<void> {
    const provider = this.providers.get(message.channel);
    if (!provider) {
      message.status = 'skipped';
      return;
    }

    try {
      await provider.send(message);
      message.status = 'sent';
      message.sent_at = new Date().toISOString();
      this.emit('message:sent', message);
      console.log(`[NotificationHub] Sent: ${message.id} via ${message.channel}`);
    } catch (error) {
      message.retries++;
      message.error = error instanceof Error ? error.message : 'Unknown';

      if (message.retries < this.config.defaults.retry_count) {
        setTimeout(() => this.queue.enqueue(message), 
          this.config.defaults.retry_delay_ms * message.retries);
      } else {
        message.status = 'failed';
        this.emit('message:failed', message);
      }
    }
  }

  // ===========================================
  // 직접 전송
  // ===========================================
  async sendDirect(
    channel: NotificationChannel,
    content: string,
    options?: { title?: string; priority?: NotificationPriority }
  ): Promise<boolean> {
    const provider = this.providers.get(channel);
    if (!provider) return false;

    const message: NotificationMessage = {
      id: `direct-${Date.now()}`,
      event: { type: 'direct', source: 'manual', payload: {}, timestamp: new Date().toISOString() },
      channel,
      priority: options?.priority || 'normal',
      rendered: { title: options?.title, body: content },
      status: 'pending',
      created_at: new Date().toISOString(),
      retries: 0,
    };

    try {
      await provider.send(message);
      return true;
    } catch {
      return false;
    }
  }

  getStats() {
    return { ...this.queue.getStats(), providers: [...this.providers.keys()] };
  }

  async testProvider(channel: NotificationChannel): Promise<boolean> {
    const provider = this.providers.get(channel);
    return provider ? provider.test() : false;
  }
}
```

### 파일: `src/notifications/queue.ts`

```typescript
import type { NotificationMessage, NotificationPriority } from '../types/notification.types';

export class NotificationQueue {
  private queues: Map<NotificationPriority, NotificationMessage[]> = new Map([
    ['urgent', []], ['high', []], ['normal', []], ['low', []],
  ]);
  private stats = { pending: 0, sent: 0, failed: 0 };

  enqueue(message: NotificationMessage): void {
    const queue = this.queues.get(message.priority) || this.queues.get('normal')!;
    queue.push(message);
    this.stats.pending++;
  }

  dequeue(): NotificationMessage | undefined {
    for (const priority of ['urgent', 'high', 'normal', 'low'] as const) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        this.stats.pending--;
        return queue.shift();
      }
    }
    return undefined;
  }

  getStats() { return { ...this.stats }; }
  clear(): void {
    this.queues.forEach(q => q.length = 0);
    this.stats = { pending: 0, sent: 0, failed: 0 };
  }
}
```

### 파일: `src/notifications/templates.ts`

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { NotificationChannel } from '../types/notification.types';

export class TemplateEngine {
  private cache: Map<string, string> = new Map();
  private templatesDir = join(process.cwd(), '.claude', 'notifications', 'templates');

  async render(
    name: string,
    channel: NotificationChannel,
    data: Record<string, any>
  ): Promise<{ title?: string; body: string; blocks?: any[]; embeds?: any[] }> {
    const template = await this.load(name);
    const body = this.interpolate(template, data);
    
    // 제목 추출
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : undefined;
    const cleanBody = title ? body.replace(/^#\s+.+\n?/, '') : body;

    // 채널별 포맷
    if (channel === 'slack') {
      return { title, body: this.toSlackMarkdown(cleanBody), blocks: this.toSlackBlocks(title, cleanBody) };
    }
    if (channel === 'discord') {
      return { title, body: cleanBody, embeds: this.toDiscordEmbeds(title, cleanBody) };
    }
    return { title, body: cleanBody };
  }

  private async load(name: string): Promise<string> {
    if (this.cache.has(name)) return this.cache.get(name)!;
    try {
      const content = await readFile(join(this.templatesDir, `${name}.md`), 'utf-8');
      this.cache.set(name, content);
      return content;
    } catch {
      return this.getDefault(name);
    }
  }

  private interpolate(template: string, data: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
      const value = key.split('.').reduce((o: any, k: string) => o?.[k], data);
      return value !== undefined ? String(value) : '';
    });
  }

  private toSlackMarkdown(text: string): string {
    return text.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^[-*]\s/gm, '• ');
  }

  private toSlackBlocks(title: string | undefined, body: string): any[] {
    const blocks: any[] = [];
    if (title) {
      blocks.push({ type: 'header', text: { type: 'plain_text', text: title, emoji: true } });
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: body.slice(0, 3000) } });
    return blocks;
  }

  private toDiscordEmbeds(title: string | undefined, body: string): any[] {
    return [{ title, description: body.slice(0, 4096), color: 0x5865F2 }];
  }

  private getDefault(name: string): string {
    return `# {{event_type}}\n\n{{task_id}}\n{{timestamp}}`;
  }
}
```

## Step 4: Provider 구현

### 파일: `src/notifications/providers/base.ts`

```typescript
import type { NotificationMessage } from '../../types/notification.types';

export abstract class BaseProvider {
  protected healthy: boolean = true;
  protected lastError?: string;

  abstract send(message: NotificationMessage): Promise<void>;
  
  async test(): Promise<boolean> {
    return this.healthy;
  }

  isHealthy(): boolean { return this.healthy; }
  getLastError(): string | undefined { return this.lastError; }

  protected setError(error: string): void {
    this.healthy = false;
    this.lastError = error;
  }

  protected clearError(): void {
    this.healthy = true;
    this.lastError = undefined;
  }
}
```

### 파일: `src/notifications/providers/slack.ts`

```typescript
import type { NotificationMessage, SlackConfig } from '../../types/notification.types';
import { BaseProvider } from './base';

export class SlackProvider extends BaseProvider {
  private config: SlackConfig;

  constructor(config: SlackConfig) {
    super();
    this.config = config;
  }

  async send(message: NotificationMessage): Promise<void> {
    const payload = this.buildPayload(message);

    if (this.config.webhook_url) {
      await this.sendViaWebhook(payload);
    } else if (this.config.bot_token) {
      await this.sendViaBot(message.recipients?.[0] || this.config.default_channel, payload);
    } else {
      throw new Error('Slack: No webhook_url or bot_token configured');
    }
  }

  private buildPayload(message: NotificationMessage): any {
    const payload: any = {
      text: message.rendered.body,
    };

    if (this.config.username) payload.username = this.config.username;
    if (this.config.icon_emoji) payload.icon_emoji = this.config.icon_emoji;
    if (message.rendered.blocks) payload.blocks = message.rendered.blocks;

    return payload;
  }

  private async sendViaWebhook(payload: any): Promise<void> {
    const response = await fetch(this.config.webhook_url!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      this.setError(`Slack webhook: ${response.status} - ${error}`);
      throw new Error(`Slack webhook failed: ${response.status}`);
    }
    this.clearError();
  }

  private async sendViaBot(channel: string, payload: any): Promise<void> {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.bot_token}`,
      },
      body: JSON.stringify({ channel, ...payload }),
    });

    const data = await response.json();
    if (!data.ok) {
      this.setError(`Slack API: ${data.error}`);
      throw new Error(`Slack API: ${data.error}`);
    }
    this.clearError();
  }

  async test(): Promise<boolean> {
    try {
      if (this.config.bot_token) {
        const response = await fetch('https://slack.com/api/auth.test', {
          headers: { 'Authorization': `Bearer ${this.config.bot_token}` },
        });
        const data = await response.json();
        return data.ok;
      }
      return true; // Webhook은 테스트 어려움
    } catch {
      return false;
    }
  }
}
```

### 파일: `src/notifications/providers/discord.ts`

```typescript
import type { NotificationMessage, DiscordConfig } from '../../types/notification.types';
import { BaseProvider } from './base';

export class DiscordProvider extends BaseProvider {
  private config: DiscordConfig;

  constructor(config: DiscordConfig) {
    super();
    this.config = config;
  }

  async send(message: NotificationMessage): Promise<void> {
    const payload = this.buildPayload(message);

    const response = await fetch(this.config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      this.setError(`Discord: ${response.status} - ${error}`);
      throw new Error(`Discord webhook failed: ${response.status}`);
    }
    this.clearError();
  }

  private buildPayload(message: NotificationMessage): any {
    const payload: any = {
      content: message.rendered.title 
        ? `**${message.rendered.title}**\n${message.rendered.body}`
        : message.rendered.body,
    };

    if (this.config.username) payload.username = this.config.username;
    if (this.config.avatar_url) payload.avatar_url = this.config.avatar_url;
    
    if (message.rendered.embeds) {
      payload.embeds = message.rendered.embeds;
      payload.content = undefined; // embed 사용 시 content 생략
    }

    return payload;
  }

  async test(): Promise<boolean> {
    try {
      // Discord webhook URL 유효성만 확인
      const url = new URL(this.config.webhook_url);
      return url.hostname === 'discord.com' || url.hostname === 'discordapp.com';
    } catch {
      return false;
    }
  }
}
```

### 파일: `src/notifications/providers/email.ts`

```typescript
import * as nodemailer from 'nodemailer';
import type { NotificationMessage, EmailConfig } from '../../types/notification.types';
import { BaseProvider } from './base';

export class EmailProvider extends BaseProvider {
  private config: EmailConfig;
  private transporter: nodemailer.Transporter;

  constructor(config: EmailConfig) {
    super();
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }

  async send(message: NotificationMessage): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.config.from,
      to: message.recipients?.join(', ') || this.config.default_to.join(', '),
      subject: message.rendered.title || 'Claude Conductor Notification',
      text: message.rendered.body,
      html: this.markdownToHtml(message.rendered.body),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.clearError();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.setError(`Email: ${msg}`);
      throw error;
    }
  }

  private markdownToHtml(markdown: string): string {
    return `
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          ${markdown
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code style="background:#f4f4f4;padding:2px 4px;">$1</code>')
            .replace(/\n/g, '<br>')}
        </body>
      </html>
    `;
  }

  async test(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
```

### 파일: `src/notifications/providers/webhook.ts`

```typescript
import * as crypto from 'crypto';
import type { NotificationMessage, WebhookConfig } from '../../types/notification.types';
import { BaseProvider } from './base';

export class WebhookProvider extends BaseProvider {
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    super();
    this.config = config;
  }

  async send(message: NotificationMessage): Promise<void> {
    const payload = {
      id: message.id,
      event: message.event,
      channel: message.channel,
      priority: message.priority,
      content: message.rendered,
      timestamp: new Date().toISOString(),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    // HMAC 서명 추가
    if (this.config.secret) {
      const signature = this.sign(JSON.stringify(payload));
      headers['X-Signature'] = signature;
      headers['X-Signature-256'] = `sha256=${signature}`;
    }

    const response = await fetch(this.config.url, {
      method: this.config.method,
      headers,
      body: this.config.method !== 'GET' ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      this.setError(`Webhook ${this.config.name}: ${response.status}`);
      throw new Error(`Webhook failed: ${response.status} - ${error}`);
    }
    this.clearError();
  }

  private sign(payload: string): string {
    return crypto
      .createHmac('sha256', this.config.secret!)
      .update(payload)
      .digest('hex');
  }

  async test(): Promise<boolean> {
    try {
      const response = await fetch(this.config.url, {
        method: 'HEAD',
      });
      return response.ok || response.status === 405; // Method Not Allowed도 OK
    } catch {
      return false;
    }
  }
}
```

---

## Step 5: GitHub 연동

### 파일: `src/integrations/github/client.ts`

```typescript
import type { GitHubConfig, GitHubPR, GitHubIssue } from '../../types/notification.types';

export class GitHubClient {
  private config: GitHubConfig;
  private baseUrl = 'https://api.github.com';

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`GitHub API error: ${error.message || response.statusText}`);
    }

    return response.json();
  }

  // ===========================================
  // PR 관련
  // ===========================================
  async createPR(params: {
    title: string;
    body: string;
    head: string;
    base?: string;
    draft?: boolean;
  }): Promise<GitHubPR> {
    const result = await this.request<any>('POST', 
      `/repos/${this.config.owner}/${this.config.repo}/pulls`,
      {
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base || 'main',
        draft: params.draft || false,
      }
    );

    return {
      number: result.number,
      title: result.title,
      url: result.html_url,
      state: result.state,
      head: result.head.ref,
      base: result.base.ref,
    };
  }

  async getPR(number: number): Promise<GitHubPR> {
    const result = await this.request<any>('GET',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${number}`
    );

    return {
      number: result.number,
      title: result.title,
      url: result.html_url,
      state: result.merged ? 'merged' : result.state,
      head: result.head.ref,
      base: result.base.ref,
    };
  }

  async listPRs(state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubPR[]> {
    const result = await this.request<any[]>('GET',
      `/repos/${this.config.owner}/${this.config.repo}/pulls?state=${state}`
    );

    return result.map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged ? 'merged' : pr.state,
      head: pr.head.ref,
      base: pr.base.ref,
    }));
  }

  async addPRLabels(number: number, labels: string[]): Promise<void> {
    await this.request('POST',
      `/repos/${this.config.owner}/${this.config.repo}/issues/${number}/labels`,
      { labels }
    );
  }

  async requestReviewers(number: number, reviewers: string[]): Promise<void> {
    await this.request('POST',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${number}/requested_reviewers`,
      { reviewers }
    );
  }

  // ===========================================
  // Issue 관련
  // ===========================================
  async createIssue(params: {
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<GitHubIssue> {
    const result = await this.request<any>('POST',
      `/repos/${this.config.owner}/${this.config.repo}/issues`,
      {
        title: params.title,
        body: params.body,
        labels: params.labels || [],
        assignees: params.assignees || [],
      }
    );

    return {
      number: result.number,
      title: result.title,
      url: result.html_url,
      state: result.state,
      labels: result.labels.map((l: any) => l.name),
    };
  }

  async getIssue(number: number): Promise<GitHubIssue> {
    const result = await this.request<any>('GET',
      `/repos/${this.config.owner}/${this.config.repo}/issues/${number}`
    );

    return {
      number: result.number,
      title: result.title,
      url: result.html_url,
      state: result.state,
      labels: result.labels.map((l: any) => l.name),
    };
  }

  async updateIssue(number: number, params: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
  }): Promise<GitHubIssue> {
    const result = await this.request<any>('PATCH',
      `/repos/${this.config.owner}/${this.config.repo}/issues/${number}`,
      params
    );

    return {
      number: result.number,
      title: result.title,
      url: result.html_url,
      state: result.state,
      labels: result.labels.map((l: any) => l.name),
    };
  }

  async listIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubIssue[]> {
    const result = await this.request<any[]>('GET',
      `/repos/${this.config.owner}/${this.config.repo}/issues?state=${state}`
    );

    // PR 제외 (issues API는 PR도 포함)
    return result
      .filter(issue => !issue.pull_request)
      .map(issue => ({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        state: issue.state,
        labels: issue.labels.map((l: any) => l.name),
      }));
  }

  // ===========================================
  // Comment 관련
  // ===========================================
  async addComment(number: number, body: string): Promise<{ id: number; url: string }> {
    const result = await this.request<any>('POST',
      `/repos/${this.config.owner}/${this.config.repo}/issues/${number}/comments`,
      { body }
    );

    return {
      id: result.id,
      url: result.html_url,
    };
  }

  async addPRReviewComment(params: {
    pr_number: number;
    body: string;
    commit_id: string;
    path: string;
    line: number;
  }): Promise<{ id: number; url: string }> {
    const result = await this.request<any>('POST',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${params.pr_number}/comments`,
      {
        body: params.body,
        commit_id: params.commit_id,
        path: params.path,
        line: params.line,
      }
    );

    return {
      id: result.id,
      url: result.html_url,
    };
  }

  // ===========================================
  // Label 관련
  // ===========================================
  async createLabel(name: string, color: string, description?: string): Promise<void> {
    await this.request('POST',
      `/repos/${this.config.owner}/${this.config.repo}/labels`,
      { name, color, description }
    );
  }

  async ensureLabels(labels: { name: string; color: string }[]): Promise<void> {
    const existing = await this.request<any[]>('GET',
      `/repos/${this.config.owner}/${this.config.repo}/labels`
    );
    const existingNames = new Set(existing.map(l => l.name));

    for (const label of labels) {
      if (!existingNames.has(label.name)) {
        await this.createLabel(label.name, label.color);
      }
    }
  }
}
```

---

## Step 6: Linear 연동

### 파일: `src/integrations/linear/client.ts`

```typescript
import type { LinearConfig, LinearIssue } from '../../types/notification.types';

export class LinearClient {
  private config: LinearConfig;
  private baseUrl = 'https://api.linear.app/graphql';

  constructor(config: LinearConfig) {
    this.config = config;
  }

  private async query<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.config.api_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`Linear API error: ${result.errors[0].message}`);
    }

    return result.data;
  }

  // ===========================================
  // Issue 생성
  // ===========================================
  async createIssue(params: {
    title: string;
    description?: string;
    priority?: number;
    labelIds?: string[];
    assigneeId?: string;
  }): Promise<LinearIssue> {
    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            state { name }
          }
        }
      }
    `;

    const data = await this.query<any>(mutation, {
      input: {
        teamId: this.config.team_id,
        projectId: this.config.project_id,
        title: params.title,
        description: params.description,
        priority: params.priority,
        labelIds: params.labelIds,
        assigneeId: params.assigneeId,
      },
    });

    const issue = data.issueCreate.issue;
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: issue.state.name,
    };
  }

  // ===========================================
  // Issue 조회
  // ===========================================
  async getIssue(id: string): Promise<LinearIssue> {
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          url
          state { name }
        }
      }
    `;

    const data = await this.query<any>(query, { id });
    const issue = data.issue;

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: issue.state.name,
    };
  }

  async getIssueByIdentifier(identifier: string): Promise<LinearIssue | null> {
    const query = `
      query GetIssue($filter: IssueFilter!) {
        issues(filter: $filter) {
          nodes {
            id
            identifier
            title
            url
            state { name }
          }
        }
      }
    `;

    const data = await this.query<any>(query, {
      filter: { identifier: { eq: identifier } },
    });

    const issue = data.issues.nodes[0];
    if (!issue) return null;

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: issue.state.name,
    };
  }

  // ===========================================
  // Issue 업데이트
  // ===========================================
  async updateIssue(id: string, params: {
    title?: string;
    description?: string;
    stateId?: string;
    priority?: number;
  }): Promise<LinearIssue> {
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            state { name }
          }
        }
      }
    `;

    const data = await this.query<any>(mutation, { id, input: params });
    const issue = data.issueUpdate.issue;

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: issue.state.name,
    };
  }

  // ===========================================
  // 상태 조회 (상태 ID 얻기 위해)
  // ===========================================
  async getWorkflowStates(): Promise<Array<{ id: string; name: string }>> {
    const query = `
      query GetStates($teamId: String!) {
        team(id: $teamId) {
          states {
            nodes {
              id
              name
            }
          }
        }
      }
    `;

    const data = await this.query<any>(query, { teamId: this.config.team_id });
    return data.team.states.nodes;
  }

  // ===========================================
  // 상태 동기화 (Conductor 상태 → Linear 상태)
  // ===========================================
  async syncStatus(issueId: string, conductorStatus: string): Promise<void> {
    const linearStatus = this.config.status_map[conductorStatus];
    if (!linearStatus) return;

    const states = await this.getWorkflowStates();
    const targetState = states.find(s => s.name === linearStatus);
    
    if (targetState) {
      await this.updateIssue(issueId, { stateId: targetState.id });
    }
  }
}
```

### 파일: `src/integrations/linear/sync.ts`

```typescript
import { LinearClient } from './client';
import type { LinearConfig, LinearIssue } from '../../types/notification.types';
import { RedisClient } from '../../redis';

export class LinearSync {
  private client: LinearClient;
  private redis: RedisClient;
  private keyPrefix = 'linear:sync:';

  constructor(config: LinearConfig, redis: RedisClient) {
    this.client = new LinearClient(config);
    this.redis = redis;
  }

  // Task ↔ Linear Issue 매핑 저장
  async linkTaskToIssue(taskId: string, linearIssue: LinearIssue): Promise<void> {
    await this.redis.set(`${this.keyPrefix}task:${taskId}`, JSON.stringify({
      linear_id: linearIssue.id,
      linear_identifier: linearIssue.identifier,
      linear_url: linearIssue.url,
      synced_at: new Date().toISOString(),
    }));

    await this.redis.set(`${this.keyPrefix}linear:${linearIssue.id}`, taskId);
  }

  async getLinearIdForTask(taskId: string): Promise<string | null> {
    const data = await this.redis.get(`${this.keyPrefix}task:${taskId}`);
    if (!data) return null;
    return JSON.parse(data).linear_id;
  }

  async getTaskIdForLinear(linearId: string): Promise<string | null> {
    return this.redis.get(`${this.keyPrefix}linear:${linearId}`);
  }

  // Task 생성 시 Linear Issue 자동 생성
  async createIssueForTask(task: {
    id: string;
    title: string;
    description?: string;
    priority?: string;
  }): Promise<LinearIssue> {
    const priorityMap: Record<string, number> = {
      'urgent': 1, 'high': 2, 'normal': 3, 'low': 4,
    };

    const issue = await this.client.createIssue({
      title: `[${task.id}] ${task.title}`,
      description: task.description,
      priority: priorityMap[task.priority || 'normal'],
    });

    await this.linkTaskToIssue(task.id, issue);
    return issue;
  }

  // Task 상태 변경 시 Linear 상태 동기화
  async syncTaskStatus(taskId: string, status: string): Promise<void> {
    const linearId = await this.getLinearIdForTask(taskId);
    if (!linearId) return;

    await this.client.syncStatus(linearId, status);
  }
}
```

## Step 7: MCP 도구 - 알림

### 파일: `src/handlers/notification.handlers.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic/mcp-server';
import { NotificationHub } from '../notifications/hub';

export function registerNotificationHandlers(server: McpServer, hub: NotificationHub) {

  // ===========================================
  // notify_send - 직접 알림 전송
  // ===========================================
  server.tool(
    'notify_send',
    '특정 채널로 알림을 직접 전송합니다.',
    {
      channel: z.enum(['slack', 'discord', 'email'])
        .describe('알림 채널'),
      message: z.string().describe('알림 내용'),
      title: z.string().optional().describe('알림 제목'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
        .describe('우선순위'),
      recipients: z.array(z.string()).optional()
        .describe('수신자 (채널별: 이메일 주소, Slack 채널 등)'),
    },
    async ({ channel, message, title, priority, recipients }) => {
      try {
        const success = await hub.sendDirect(channel, message, { title, priority });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success,
              channel,
              message: success ? '알림이 전송되었습니다.' : '전송 실패',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // notify_broadcast - 모든 채널에 알림
  // ===========================================
  server.tool(
    'notify_broadcast',
    '활성화된 모든 채널로 알림을 전송합니다.',
    {
      message: z.string().describe('알림 내용'),
      title: z.string().optional().describe('알림 제목'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    },
    async ({ message, title, priority }) => {
      try {
        await hub.notify({
          type: 'broadcast',
          source: 'manual',
          payload: { message, title },
          timestamp: new Date().toISOString(),
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '브로드캐스트 알림이 큐에 추가되었습니다.',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // notify_status - 알림 시스템 상태
  // ===========================================
  server.tool(
    'notify_status',
    '알림 시스템 상태 및 통계를 조회합니다.',
    {},
    async () => {
      const stats = hub.getStats();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            stats,
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================
  // notify_test - 채널 테스트
  // ===========================================
  server.tool(
    'notify_test',
    '알림 채널 연결을 테스트합니다.',
    {
      channel: z.enum(['slack', 'discord', 'email']).describe('테스트할 채널'),
    },
    async ({ channel }) => {
      try {
        const success = await hub.testProvider(channel);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success,
              channel,
              message: success ? '연결 정상' : '연결 실패',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}
```

---

## Step 8: MCP 도구 - GitHub

### 파일: `src/handlers/github.handlers.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic/mcp-server';
import { GitHubClient } from '../integrations/github/client';
import type { GitHubConfig } from '../types/notification.types';

export function registerGitHubHandlers(server: McpServer, config: GitHubConfig) {
  const github = new GitHubClient(config);

  // ===========================================
  // github_pr_create - PR 생성
  // ===========================================
  server.tool(
    'github_pr_create',
    'GitHub Pull Request를 생성합니다.',
    {
      title: z.string().describe('PR 제목'),
      body: z.string().describe('PR 본문 (마크다운)'),
      head: z.string().describe('소스 브랜치'),
      base: z.string().default('main').describe('대상 브랜치'),
      draft: z.boolean().default(false).describe('Draft PR 여부'),
      labels: z.array(z.string()).optional().describe('라벨'),
      reviewers: z.array(z.string()).optional().describe('리뷰어 (GitHub 사용자명)'),
    },
    async ({ title, body, head, base, draft, labels, reviewers }) => {
      try {
        const pr = await github.createPR({ title, body, head, base, draft });

        if (labels?.length) {
          await github.addPRLabels(pr.number, labels);
        }
        if (reviewers?.length) {
          await github.requestReviewers(pr.number, reviewers);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              pr: {
                number: pr.number,
                title: pr.title,
                url: pr.url,
                state: pr.state,
              },
              message: `PR #${pr.number} 생성됨`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // github_pr_list - PR 목록
  // ===========================================
  server.tool(
    'github_pr_list',
    'GitHub Pull Request 목록을 조회합니다.',
    {
      state: z.enum(['open', 'closed', 'all']).default('open'),
    },
    async ({ state }) => {
      try {
        const prs = await github.listPRs(state);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: prs.length,
              prs: prs.map(pr => ({
                number: pr.number,
                title: pr.title,
                url: pr.url,
                state: pr.state,
                head: pr.head,
                base: pr.base,
              })),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // github_issue_create - Issue 생성
  // ===========================================
  server.tool(
    'github_issue_create',
    'GitHub Issue를 생성합니다.',
    {
      title: z.string().describe('Issue 제목'),
      body: z.string().describe('Issue 본문'),
      labels: z.array(z.string()).optional().describe('라벨'),
      assignees: z.array(z.string()).optional().describe('담당자'),
    },
    async ({ title, body, labels, assignees }) => {
      try {
        const issue = await github.createIssue({ title, body, labels, assignees });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              issue: {
                number: issue.number,
                title: issue.title,
                url: issue.url,
              },
              message: `Issue #${issue.number} 생성됨`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // github_issue_list - Issue 목록
  // ===========================================
  server.tool(
    'github_issue_list',
    'GitHub Issue 목록을 조회합니다.',
    {
      state: z.enum(['open', 'closed', 'all']).default('open'),
    },
    async ({ state }) => {
      try {
        const issues = await github.listIssues(state);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: issues.length,
              issues: issues.map(i => ({
                number: i.number,
                title: i.title,
                url: i.url,
                state: i.state,
                labels: i.labels,
              })),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // github_comment - 코멘트 추가
  // ===========================================
  server.tool(
    'github_comment',
    'PR 또는 Issue에 코멘트를 추가합니다.',
    {
      number: z.number().describe('PR 또는 Issue 번호'),
      body: z.string().describe('코멘트 내용'),
    },
    async ({ number, body }) => {
      try {
        const comment = await github.addComment(number, body);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              comment: {
                id: comment.id,
                url: comment.url,
              },
              message: `코멘트가 추가되었습니다.`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // github_link_task - Task와 Issue/PR 연결
  // ===========================================
  server.tool(
    'github_link_task',
    'Task ID를 GitHub Issue/PR에 연결합니다.',
    {
      task_id: z.string().describe('Task ID'),
      type: z.enum(['issue', 'pr']).describe('연결 대상 타입'),
      number: z.number().describe('Issue 또는 PR 번호'),
    },
    async ({ task_id, type, number }) => {
      try {
        // Task 라벨 추가
        const label = `${config.label_prefix}${task_id}`;
        await github.addPRLabels(number, [label]);

        // 코멘트로 연결 표시
        await github.addComment(number, 
          `🔗 Linked to Conductor Task: **${task_id}**`
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              task_id,
              type,
              number,
              message: `Task ${task_id}가 ${type} #${number}에 연결되었습니다.`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}
```

---

## Step 9: MCP 도구 - Webhook

### 파일: `src/handlers/webhook.handlers.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic/mcp-server';
import type { WebhookConfig } from '../types/notification.types';

export function registerWebhookHandlers(
  server: McpServer, 
  webhooks: WebhookConfig[],
  registerCallback: (webhook: WebhookConfig) => void
) {

  // ===========================================
  // webhook_list - Webhook 목록
  // ===========================================
  server.tool(
    'webhook_list',
    '등록된 Webhook 목록을 조회합니다.',
    {},
    async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: webhooks.length,
            webhooks: webhooks.map(w => ({
              id: w.id,
              name: w.name,
              url: w.url,
              method: w.method,
              events: w.events,
              enabled: w.enabled,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================
  // webhook_register - Webhook 등록
  // ===========================================
  server.tool(
    'webhook_register',
    '새 Webhook을 등록합니다.',
    {
      id: z.string().describe('Webhook ID (고유)'),
      name: z.string().describe('Webhook 이름'),
      url: z.string().url().describe('Webhook URL'),
      method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
      events: z.array(z.string()).describe('구독할 이벤트 패턴 (예: task.*, review.*)'),
      headers: z.record(z.string()).optional().describe('추가 헤더'),
      secret: z.string().optional().describe('HMAC 서명용 시크릿'),
    },
    async ({ id, name, url, method, events, headers, secret }) => {
      // 중복 체크
      if (webhooks.find(w => w.id === id)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Webhook ID '${id}'가 이미 존재합니다.`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      const webhook: WebhookConfig = {
        id,
        name,
        url,
        method,
        events,
        headers,
        secret,
        enabled: true,
      };

      webhooks.push(webhook);
      registerCallback(webhook);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            webhook: { id, name, url, events },
            message: `Webhook '${name}' 등록됨`,
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================
  // webhook_toggle - Webhook 활성화/비활성화
  // ===========================================
  server.tool(
    'webhook_toggle',
    'Webhook을 활성화/비활성화합니다.',
    {
      id: z.string().describe('Webhook ID'),
      enabled: z.boolean().describe('활성화 여부'),
    },
    async ({ id, enabled }) => {
      const webhook = webhooks.find(w => w.id === id);
      if (!webhook) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Webhook '${id}'를 찾을 수 없습니다.`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      webhook.enabled = enabled;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            id,
            enabled,
            message: `Webhook '${webhook.name}' ${enabled ? '활성화' : '비활성화'}됨`,
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================
  // webhook_test - Webhook 테스트
  // ===========================================
  server.tool(
    'webhook_test',
    'Webhook에 테스트 페이로드를 전송합니다.',
    {
      id: z.string().describe('Webhook ID'),
    },
    async ({ id }) => {
      const webhook = webhooks.find(w => w.id === id);
      if (!webhook) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Webhook '${id}'를 찾을 수 없습니다.`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      try {
        const testPayload = {
          type: 'test',
          source: 'conductor',
          timestamp: new Date().toISOString(),
          message: 'This is a test webhook payload',
        };

        const response = await fetch(webhook.url, {
          method: webhook.method,
          headers: {
            'Content-Type': 'application/json',
            ...webhook.headers,
          },
          body: webhook.method !== 'GET' ? JSON.stringify(testPayload) : undefined,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.ok,
              status: response.status,
              statusText: response.statusText,
              message: response.ok ? '테스트 성공' : '테스트 실패',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // webhook_delete - Webhook 삭제
  // ===========================================
  server.tool(
    'webhook_delete',
    'Webhook을 삭제합니다.',
    {
      id: z.string().describe('Webhook ID'),
    },
    async ({ id }) => {
      const index = webhooks.findIndex(w => w.id === id);
      if (index === -1) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Webhook '${id}'를 찾을 수 없습니다.`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      const [removed] = webhooks.splice(index, 1);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            id,
            name: removed.name,
            message: `Webhook '${removed.name}' 삭제됨`,
          }, null, 2),
        }],
      };
    }
  );
}
```

---

## Step 10: 설정 파일

### 파일: `.claude/notifications/config.yaml`

```yaml
# 알림 시스템 설정
enabled: true

defaults:
  priority: normal
  retry_count: 3
  retry_delay_ms: 5000

channels:
  # Slack 설정
  slack:
    enabled: true
    webhook_url: "${SLACK_WEBHOOK_URL}"
    # 또는 Bot Token 사용
    # bot_token: "${SLACK_BOT_TOKEN}"
    default_channel: "#dev-notifications"
    username: "Claude Conductor"
    icon_emoji: ":robot_face:"

  # Discord 설정
  discord:
    enabled: false
    webhook_url: "${DISCORD_WEBHOOK_URL}"
    username: "Claude Conductor"

  # Email 설정
  email:
    enabled: false
    smtp:
      host: "smtp.gmail.com"
      port: 587
      secure: false
      user: "${SMTP_USER}"
      pass: "${SMTP_PASS}"
    from: "conductor@example.com"
    default_to:
      - "team@example.com"

  # 커스텀 Webhooks
  webhooks:
    - id: "zapier"
      name: "Zapier Integration"
      url: "${ZAPIER_WEBHOOK_URL}"
      method: POST
      events: ["task.completed", "review.approved"]
      enabled: true

# 라우팅 규칙
rules:
  # 긴급 태스크는 모든 채널로
  - id: urgent-tasks
    name: "긴급 태스크 알림"
    event_pattern: "task.*"
    conditions:
      - field: "payload.priority"
        operator: eq
        value: "urgent"
    channels: [slack, discord, email]
    priority: urgent
    enabled: true

  # 리뷰 요청은 Slack으로
  - id: review-requests
    name: "리뷰 요청"
    event_pattern: "review.requested"
    channels: [slack]
    priority: high
    template: "review-requested"
    enabled: true

  # Agent 에러는 Slack + Email
  - id: agent-errors
    name: "Agent 오류"
    event_pattern: "agent.error"
    channels: [slack, email]
    priority: high
    template: "agent-error"
    enabled: true

  # 태스크 완료는 Slack
  - id: task-completed
    name: "태스크 완료"
    event_pattern: "task.completed"
    channels: [slack]
    priority: normal
    enabled: true

  # 서버 오류
  - id: server-errors
    name: "서버 오류"
    event_pattern: "server.error"
    channels: [slack, email]
    priority: urgent
    enabled: true
```

### 파일: `.claude/notifications/templates/review-requested.md`

```markdown
# 👀 리뷰 요청

**Task**: {{task_id}}
**제목**: {{title}}

## 변경 사항
- 브랜치: `{{branch_name}}`
- 변경 파일: {{changed_files}}개

## 요약
{{summary}}

---
[대시보드에서 보기]({{dashboard_url}})
```

### 파일: `.claude/notifications/templates/agent-error.md`

```markdown
# ❌ Agent 오류

## Agent 정보
- **ID**: `{{agent_id}}`
- **역할**: {{role}}
- **태스크**: {{task_id}}

## 오류 내용
```
{{error}}
```

## 타임스탬프
{{timestamp}}

---
*즉시 확인이 필요합니다.*
```

---

## Step 11: 검증 테스트

### 테스트 1: Slack 알림 전송

```bash
# Claude Code에서 실행
> notify_send channel="slack" message="테스트 알림입니다" title="테스트"

# 예상 출력:
{
  "success": true,
  "channel": "slack",
  "message": "알림이 전송되었습니다."
}
```

### 테스트 2: GitHub PR 생성

```bash
> github_pr_create \
    title="feat: Add user authentication" \
    body="## Changes\n- Add login\n- Add logout" \
    head="feature/auth" \
    base="main" \
    labels=["enhancement"]

# 예상 출력:
{
  "success": true,
  "pr": {
    "number": 42,
    "title": "feat: Add user authentication",
    "url": "https://github.com/owner/repo/pull/42",
    "state": "open"
  }
}
```

### 테스트 3: Webhook 등록 및 테스트

```bash
> webhook_register \
    id="custom-hook" \
    name="Custom Webhook" \
    url="https://example.com/webhook" \
    events=["task.*"]

> webhook_test id="custom-hook"

# 예상 출력:
{
  "success": true,
  "status": 200,
  "message": "테스트 성공"
}
```

### 테스트 4: 이벤트 기반 알림

```bash
# Task 완료 이벤트 발생 시 자동 알림
> task_transition task_id="TASK-001" to="DONE"

# Slack 채널에 자동으로 알림 전송됨
```

---

## 파일 체크리스트

### 신규 파일

| 파일 | 설명 | 우선순위 |
|------|------|:--------:|
| `src/types/notification.types.ts` | 알림 타입 정의 | P0 |
| `src/notifications/hub.ts` | 알림 허브 | P0 |
| `src/notifications/queue.ts` | 알림 큐 | P0 |
| `src/notifications/templates.ts` | 템플릿 엔진 | P0 |
| `src/notifications/providers/base.ts` | Provider 베이스 | P0 |
| `src/notifications/providers/slack.ts` | Slack Provider | P0 |
| `src/notifications/providers/discord.ts` | Discord Provider | P1 |
| `src/notifications/providers/email.ts` | Email Provider | P1 |
| `src/notifications/providers/webhook.ts` | Webhook Provider | P1 |
| `src/integrations/github/client.ts` | GitHub 클라이언트 | P0 |
| `src/integrations/linear/client.ts` | Linear 클라이언트 | P2 |
| `src/integrations/linear/sync.ts` | Linear 동기화 | P2 |
| `src/handlers/notification.handlers.ts` | 알림 MCP 도구 | P0 |
| `src/handlers/github.handlers.ts` | GitHub MCP 도구 | P0 |
| `src/handlers/webhook.handlers.ts` | Webhook MCP 도구 | P1 |
| `.claude/notifications/config.yaml` | 알림 설정 | P0 |
| `.claude/notifications/templates/*.md` | 알림 템플릿 | P1 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/index.ts` | 알림/GitHub 핸들러 등록, 이벤트 연결 |
| `docker-compose.yml` | 환경변수 추가 (SLACK_*, GITHUB_*, etc.) |
| `src/types/index.ts` | 알림 타입 export |

---

## MCP 도구 요약

### 알림 도구

| 도구 | 설명 |
|------|------|
| `notify_send` | 특정 채널로 직접 알림 전송 |
| `notify_broadcast` | 모든 채널로 알림 전송 |
| `notify_status` | 알림 시스템 상태 조회 |
| `notify_test` | 채널 연결 테스트 |

### GitHub 도구

| 도구 | 설명 |
|------|------|
| `github_pr_create` | PR 생성 |
| `github_pr_list` | PR 목록 조회 |
| `github_issue_create` | Issue 생성 |
| `github_issue_list` | Issue 목록 조회 |
| `github_comment` | 코멘트 추가 |
| `github_link_task` | Task와 Issue/PR 연결 |

### Webhook 도구

| 도구 | 설명 |
|------|------|
| `webhook_list` | Webhook 목록 |
| `webhook_register` | Webhook 등록 |
| `webhook_toggle` | 활성화/비활성화 |
| `webhook_test` | 테스트 전송 |
| `webhook_delete` | Webhook 삭제 |

---

*Phase 6 상세 스펙 문서 끝*
*이전: Phase 5 - Sub Agent 오케스트레이션*
*다음: Phase 7 - 고도화 및 폴리싱*
