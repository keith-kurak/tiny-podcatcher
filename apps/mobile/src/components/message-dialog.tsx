import { AlertDialog, Host, Text, TextButton } from '@expo/ui/jetpack-compose';

interface MessageDialogProps {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
}

/** A dialog that only informs: a title, a message, and an OK button. */
export function MessageDialog({ visible, title, message, onDismiss }: MessageDialogProps) {
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
          <TextButton onClick={onDismiss}>
            <Text>OK</Text>
          </TextButton>
        </AlertDialog.ConfirmButton>
      </AlertDialog>
    </Host>
  );
}
