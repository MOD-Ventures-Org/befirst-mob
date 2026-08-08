import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  onRequestPermission: () => void;
  onOpenVideoReplay?: () => void;
}

const PermissionPlaceholder = ({ onRequestPermission, onOpenVideoReplay }: Props) => {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>
        Camera permission is required to detect your exercise form.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onRequestPermission}>
        <Text style={styles.buttonText}>Grant Permission</Text>
      </TouchableOpacity>
      {__DEV__ && onOpenVideoReplay ? (
        <TouchableOpacity style={styles.replayButton} onPress={onOpenVideoReplay}>
          <Text style={styles.replayButtonText}>Test a recorded video</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  message: {
    textAlign: 'center',
    marginBottom: 24,
    fontSize: 16,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#000',
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
  replayButton: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#555',
  },
  replayButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default PermissionPlaceholder;
