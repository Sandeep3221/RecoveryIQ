export interface RecoveryNudgeMessage { to: string; subject: string; text: string; templateVersion: string; }
export interface RecoveryNotificationResult { deliveryMode: "simulation" | "live"; customerContacted: boolean; deliveryStatus: "simulated" | "delivered"; providerMessageId?: string; }
export interface RecoveryNotificationService { send(message: RecoveryNudgeMessage, idempotencyKey: string): Promise<RecoveryNotificationResult>; }

export class SimulationRecoveryNotificationService implements RecoveryNotificationService {
  async send(_message: RecoveryNudgeMessage, _idempotencyKey: string): Promise<RecoveryNotificationResult> {
    return { deliveryMode: "simulation", customerContacted: false, deliveryStatus: "simulated" };
  }
}
