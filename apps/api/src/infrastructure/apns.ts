import { connect, constants, type ClientHttp2Session } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import type { AppRepository } from "../repository.js";

/** Push в iOS-приложение. Без ключа APNs (нет аккаунта Apple) — молча ничего не делает. */
export interface PushGateway {
  notifyOwner(
    ownerId: string,
    message: { title: string; body: string; kind?: string; badge?: number },
  ): Promise<number>;
}

export interface ApnsConfig {
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  /** Содержимое .p8; переводы строк можно передать как \n. */
  APNS_PRIVATE_KEY?: string;
  APNS_BUNDLE_ID?: string;
}

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

/** Короткий текст уведомления: первая содержательная строка без разметки. */
export function pushPreview(text: string, max = 180) {
  const plain = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export class ApnsPushGateway implements PushGateway {
  private token?: { value: string; issuedAt: number };
  private sessions = new Map<string, ClientHttp2Session>();

  constructor(
    private readonly repository: AppRepository,
    private readonly config: Required<Pick<ApnsConfig, "APNS_KEY_ID" | "APNS_TEAM_ID" | "APNS_PRIVATE_KEY">> & {
      APNS_BUNDLE_ID: string;
    },
  ) {}

  static fromEnv(repository: AppRepository, env: ApnsConfig): PushGateway | undefined {
    if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_PRIVATE_KEY) return undefined;
    return new ApnsPushGateway(repository, {
      APNS_KEY_ID: env.APNS_KEY_ID,
      APNS_TEAM_ID: env.APNS_TEAM_ID,
      APNS_PRIVATE_KEY: env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n"),
      APNS_BUNDLE_ID: env.APNS_BUNDLE_ID || "ru.ealzy.app",
    });
  }

  async notifyOwner(
    ownerId: string,
    message: { title: string; body: string; kind?: string; badge?: number },
  ) {
    const devices = await this.repository.listDevices(ownerId);
    let delivered = 0;
    for (const device of devices) {
      try {
        const status = await this.send(device.environment, device.push_token, {
          aps: {
            alert: { title: message.title, body: message.body },
            sound: "default",
            ...(message.badge === undefined ? {} : { badge: message.badge }),
          },
          kind: message.kind ?? "message",
        });
        if (status === 200) delivered += 1;
        // 410 — приложение удалено или токен сменился: больше не шлём.
        if (status === 410 || status === 400) await this.repository.deleteDevice(ownerId, device.push_token);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "apns_send_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return delivered;
  }

  private async providerToken() {
    // Apple принимает токен до часа и просит не обновлять чаще раза в 20 минут.
    if (this.token && Date.now() - this.token.issuedAt < 40 * 60_000) return this.token.value;
    const key = await importPKCS8(this.config.APNS_PRIVATE_KEY, "ES256");
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.config.APNS_KEY_ID })
      .setIssuer(this.config.APNS_TEAM_ID)
      .setIssuedAt()
      .sign(key);
    this.token = { value, issuedAt: Date.now() };
    return value;
  }

  private session(environment: "sandbox" | "production") {
    const existing = this.sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = connect(HOSTS[environment]);
    session.on("error", () => this.sessions.delete(environment));
    session.on("close", () => this.sessions.delete(environment));
    session.unref();
    this.sessions.set(environment, session);
    return session;
  }

  private async send(environment: "sandbox" | "production", deviceToken: string, payload: unknown) {
    const token = await this.providerToken();
    const body = JSON.stringify(payload);
    return new Promise<number>((resolve, reject) => {
      const request = this.session(environment).request({
        [constants.HTTP2_HEADER_METHOD]: "POST",
        [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
        authorization: `bearer ${token}`,
        "apns-topic": this.config.APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "content-type": "application/json",
      });
      request.setTimeout(10_000, () => request.close(constants.NGHTTP2_CANCEL));
      let status = 0;
      request.on("response", (headers) => {
        status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
      });
      request.on("data", () => undefined);
      request.on("end", () => resolve(status));
      request.on("error", reject);
      request.end(body);
    });
  }
}
