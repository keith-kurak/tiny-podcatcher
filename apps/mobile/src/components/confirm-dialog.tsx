import { AlertDialog, Host, Text, TextButton } from '@expo/ui/jetpack-compose';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  /** The affirmative button's label. Name the action, not "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * A yes/no dialog whose confirm button says what it will do.
 *
 * `RemoveDialog` is the same shape with "Remove" baked in, which is right for the
 * destructive cases it serves and wrong for anything else — a dialog offering to start
 * a download should not answer with "Remove".
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onDismiss,
}: ConfirmDialogProps) {
  if (!visible) return null;

  return (
    <Host matchContents>
      <AlertDialog onDismissRequest={onDismiss}>
        <AlertDialog.Title>
          <Text>{title}</Text>
        </AlertDialog.Title>
        <AlertDialog.Text>
          <Text>{message}</Text>
        </AlertDialog.Text>
        <AlertDialog.ConfirmButton>
          <TextButton onClick={onConfirm}>
            <Text>{confirmLabel}</Text>
          </TextButton>
        </AlertDialog.ConfirmButton>
        <AlertDialog.DismissButton>
          <TextButton onClick={onDismiss}>
            <Text>Cancel</Text>
          </TextButton>
        </AlertDialog.DismissButton>
      </AlertDialog>
    </Host>
  );
}
