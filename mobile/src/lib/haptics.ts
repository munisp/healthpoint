/**
 * Haptic feedback helpers (expo-haptics).
 *
 * Every helper is fire-and-forget and NEVER throws — haptics are a
 * nicety, not a requirement, and must not break an action when the
 * device doesn't support them.
 */
import * as Haptics from "expo-haptics";

/** Light tap — selection changes (chips, tab-level actions). */
export function hapticSelection(): void {
  void Haptics.selectionAsync().catch(() => {});
}

/** Medium impact — meaningful confirmations (advance step, mark read). */
export function hapticConfirm(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Success notification — a mutation completed successfully. */
export function hapticSuccess(): void {
  void Haptics.notificationAsync(
    Haptics.NotificationFeedbackType.Success
  ).catch(() => {});
}

/** Warning/error notification — failed actions, biometric lockout. */
export function hapticError(): void {
  void Haptics.notificationAsync(
    Haptics.NotificationFeedbackType.Error
  ).catch(() => {});
}
