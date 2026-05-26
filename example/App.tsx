import React, {useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';

import {
  InterfaceType,
  StarDeviceDiscoveryManager,
  StarDeviceDiscoveryManagerFactory,
  StarPrinter,
  StarConnectionSettings,
  StarXpandCommand,
} from 'react-native-star-io10';

import RNFS from 'react-native-fs';
import axios from 'axios';
import {encode} from 'base64-arraybuffer';

export default function App() {
  const [printers, setPrinters] = useState<StarPrinter[]>([]);
  const [manager, setManager] = useState<StarDeviceDiscoveryManager>();
  const [selectedPrinter, setSelectedPrinter] = useState<StarPrinter | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [localImagePath, setLocalImagePath] = useState<string | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // 🧠 Change this to your WebSocket server URL
  const WS_SERVER_URL = 'wss://voisely.com/ws';

  const addLog = (msg: string) => {
    console.log(msg);
    setLogs(prev => [
      ...prev,
      `🕓 ${new Date().toLocaleTimeString()} - ${msg}`,
    ]);
  };

  useEffect(() => {
    startDiscovery();
    return () => {
      stopDiscovery();
    };
  }, []);

  async function stopDiscovery() {
    try {
      await manager?.stopDiscovery();
      addLog('🔇 Discovery stopped.');
    } catch (e) {
      addLog(`Stop discovery error: ${e}`);
    }
  }

  async function startDiscovery() {
    setPrinters([]);
    setErrorMessage(null);
    addLog('🔍 Starting printer discovery...');
    try {
      const discoveryManager = await StarDeviceDiscoveryManagerFactory.create([
        InterfaceType.Bluetooth,
      ]);
      setManager(discoveryManager);

      discoveryManager.discoveryTime = 10000;

      discoveryManager.onPrinterFound = (printer: StarPrinter) => {
        addLog(`✅ Found printer: ${printer.connectionSettings.identifier}`);
        setPrinters(prev => [...prev, printer]);
      };

      discoveryManager.onDiscoveryFinished = () => {
        addLog('✅ Discovery finished.');
      };

      if (Platform.OS === 'android' && Platform.Version >= 31) {
        const hasPermission = await confirmBluetoothPermission();
        if (!hasPermission) {
          setErrorMessage(
            '⚠️ You must allow Nearby devices permission for Bluetooth printer.',
          );
          addLog('❌ Bluetooth permission denied.');
          return;
        }
      }

      await discoveryManager.startDiscovery();
    } catch (error: any) {
      setErrorMessage(`Discovery error: ${error.message || error.toString()}`);
      addLog(`❌ Discovery error: ${error.message || error.toString()}`);
    }
  }

  async function confirmBluetoothPermission(): Promise<boolean> {
    try {
      let hasPermission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      );
      if (!hasPermission) {
        const status = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        );
        hasPermission = status === PermissionsAndroid.RESULTS.GRANTED;
      }
      return hasPermission;
    } catch (err) {
      addLog(`⚠️ Permission check error: ${err}`);
      return false;
    }
  }

  // 🧱 WebSocket connection setup
  useEffect(() => {
    if (selectedPrinter) {
      connectWebSocket();
    }
  }, [selectedPrinter]);

  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    addLog('🔗 Connecting to WebSocket...');
    const ws = new WebSocket(WS_SERVER_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      addLog('✅ WebSocket connected.');
    };

    ws.onmessage = async event => {
      addLog(`📩 Message received: ${event.data}`);

      try {
        const data = JSON.parse(event.data);

        if (data.imageUrl && data.message) {
          addLog('🖼️ New print job received!');
          await printFromUrl(selectedPrinter!, data.imageUrl);
        } else {
          addLog('⚠️ Message does not contain valid receipt info.');
        }
      } catch (err) {
        addLog(`❌ Failed to parse message: ${err}`);
      }
    };

    ws.onerror = e => {
      addLog(`❌ WebSocket error: ${JSON.stringify(e)}`);
    };

    ws.onclose = () => {
      addLog('🔌 WebSocket disconnected.');
    };
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      addLog('🔌 WebSocket connection closed.');
    }
  };

  // 🔥 Core print function
  async function printFromUrl(printer: StarPrinter, imageUrl: string) {
    setErrorMessage(null);
    setLoading(true);

    const settings = new StarConnectionSettings();
    settings.interfaceType = printer.connectionSettings.interfaceType;
    settings.identifier = printer.connectionSettings.identifier;

    const starPrinter = new StarPrinter(settings);

    try {
      addLog(`⬇️ Downloading image from ${imageUrl}`);
      const response = await axios.get(imageUrl, {responseType: 'arraybuffer'});
      const base64Data = encode(response.data);
      addLog(`✅ Image downloaded. Base64 length: ${base64Data.length}`);

      // Save locally for preview (optional)
      const tempFile = `${RNFS.ExternalDirectoryPath}/receipt_preview.png`;
      await RNFS.writeFile(tempFile, base64Data, 'base64');
      setLocalImagePath(`file://${tempFile}`);

      addLog('🧱 Building print command...');
      const builder = new StarXpandCommand.StarXpandCommandBuilder();
      builder.addDocument(
        new StarXpandCommand.DocumentBuilder().addPrinter(
          new StarXpandCommand.PrinterBuilder()
            .actionPrintImage(
              new StarXpandCommand.Printer.ImageParameter(base64Data, 600),
            )
            .actionPrintText('\n🧾 Order Receipt ✅\n')
            .actionCut(StarXpandCommand.Printer.CutType.Partial),
        ),
      );

      const commands = await builder.getCommands();

      addLog('🔗 Connecting to printer...');
      await starPrinter.open();
      await starPrinter.print(commands);
      addLog('🎉 Print successful!');
    } catch (error: any) {
      const errMsg = `❌ Print error: ${error.message || error}`;
      addLog(errMsg);
      setErrorMessage(errMsg);
    } finally {
      setLoading(false);
      await starPrinter.close();
      await starPrinter.dispose();
      addLog('🔌 Printer connection closed.');
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>🖨️ Star Printer + WebSocket Demo</Text>

        <Pressable style={styles.button} onPress={startDiscovery}>
          <Text style={styles.buttonText}>🔍 Scan for Printers</Text>
        </Pressable>

        <FlatList
          data={printers}
          keyExtractor={(item, index) => index.toString()}
          renderItem={({item}) => (
            <Pressable
              onPress={() => setSelectedPrinter(item)}
              style={[
                styles.printerItem,
                selectedPrinter?.connectionSettings.identifier ===
                  item.connectionSettings.identifier &&
                  styles.selectedPrinterItem,
              ]}>
              <Text
                style={[
                  styles.printerText,
                  selectedPrinter?.connectionSettings.identifier ===
                    item.connectionSettings.identifier &&
                    styles.selectedPrinterText,
                ]}>
                {item.connectionSettings.interfaceType} -{' '}
                {item.connectionSettings.identifier}
              </Text>
            </Pressable>
          )}
        />

        {selectedPrinter && (
          <View style={styles.detailsContainer}>
            <Text style={styles.subTitle}>Selected Printer</Text>
            <Text>
              Type: {selectedPrinter.connectionSettings.interfaceType}
            </Text>
            <Text>ID: {selectedPrinter.connectionSettings.identifier}</Text>
            <Text>🧠 Waiting for WebSocket messages...</Text>
          </View>
        )}

        {loading && (
          <ActivityIndicator
            size="large"
            color="#2563EB"
            style={{marginTop: 20}}
          />
        )}

        {errorMessage && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {localImagePath && (
          <View style={{marginTop: 20, alignItems: 'center'}}>
            <Text style={{fontWeight: '600'}}>🖼️ Latest Receipt Preview</Text>
            <Image
              source={{uri: localImagePath}}
              style={{width: 250, height: 250, marginTop: 10, borderRadius: 8}}
              resizeMode="contain"
            />
          </View>
        )}

        <Text style={[styles.subTitle, {marginTop: 30}]}>📜 Logs</Text>
        <ScrollView
          style={styles.logBox}
          ref={scrollViewRef}
          onContentSizeChange={() =>
            scrollViewRef.current?.scrollToEnd({animated: true})
          }>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>
              {log}
            </Text>
          ))}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  container: {
    flexGrow: 1,
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 15,
  },
  subTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  printerItem: {
    padding: 15,
    marginVertical: 6,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  selectedPrinterItem: {
    backgroundColor: '#2563EB',
  },
  printerText: {
    color: '#111827',
  },
  selectedPrinterText: {
    color: '#FFFFFF',
  },
  button: {
    marginTop: 15,
    backgroundColor: '#2563EB',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  detailsContainer: {
    marginTop: 20,
    padding: 15,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  errorBox: {
    marginTop: 20,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  errorText: {
    color: '#991B1B',
    fontWeight: '500',
  },
  logBox: {
    backgroundColor: '#111827',
    borderRadius: 8,
    marginTop: 10,
    padding: 10,
    maxHeight: 250,
  },
  logText: {
    color: '#D1D5DB',
    fontSize: 12,
    marginBottom: 4,
  },
});
