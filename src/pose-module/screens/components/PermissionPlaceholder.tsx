import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  onRequestPermission: () => void;
}

const PermissionPlaceholder = ({ onRequestPermission }: Props) => {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>
        Camera permission is required to detect your exercise form.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onRequestPermission}>
        <Text style={styles.buttonText}>Grant Permission</Text>
      </TouchableOpacity>
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
});

export default PermissionPlaceholder;
