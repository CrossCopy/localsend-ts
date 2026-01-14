#!/usr/bin/env node
import React, { useState, useEffect, useCallback } from 'react'
import { render, Text, Box, useInput, useApp } from 'ink'
import { defineCommand, runMain } from "citty"
import { getDeviceInfo, LocalSendHonoServer } from "./index.ts"
import { createDiscovery, createScanner } from "./discovery/runtime.ts"
import type { DeviceInfo } from "./index.ts"
import prettyBytes from "pretty-bytes"

// Extended DeviceInfo with IP for discovered devices
interface DiscoveredDevice extends DeviceInfo {
	ip: string
}

// Types
type Screen = 'main' | 'devices' | 'send-text' | 'send-file' | 'receive' | 'settings'
type SendMode = 'text' | 'file'

interface AppState {
	screen: Screen
	selectedDeviceIndex: number
	devices: DiscoveredDevice[]
	deviceInfo: DeviceInfo
	isScanning: boolean
	lastScanTime: Date | null
	sendMode: SendMode | null
	textInput: string
	fileInput: string
	isReceiving: boolean
	receivedFiles: Array<{
		fileName: string
		size: number
		time: string
		type: string
	}>
}

// Utility components
const Header: React.FC<{ title: string; deviceName: string; port: number }> = ({ title, deviceName, port }) => (
	<Box flexDirection="column" marginBottom={1}>
		<Box justifyContent="center" paddingX={2} paddingY={1}>
			<Text color="cyan" bold>
				🌐 LocalSend TUI - {title}
			</Text>
		</Box>
		<Box justifyContent="center">
			<Text color="gray">
				Device: {deviceName} | Port: {port}
			</Text>
		</Box>
	</Box>
)

const StatusBar: React.FC<{ isScanning: boolean; lastScanTime: Date | null; deviceCount: number }> = ({ 
	isScanning, 
	lastScanTime, 
	deviceCount 
}) => (
	<Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
		<Text>
			Status: <Text color={isScanning ? "yellow" : "green"}>
				{isScanning ? "🔍 Scanning..." : "✓ Ready"}
			</Text>
			{" | "}
			Devices: <Text color="cyan">{deviceCount}</Text>
			{" | "}
			Last scan: <Text color="gray">
				{lastScanTime ? lastScanTime.toLocaleTimeString() : "Never"}
			</Text>
		</Text>
	</Box>
)

const DeviceList: React.FC<{ 
	devices: DiscoveredDevice[]
	selectedIndex: number
	onSelect: (index: number) => void
}> = ({ devices, selectedIndex, onSelect: _onSelect }) => (
	<Box flexDirection="column" marginY={1}>
		<Text color="yellow" bold>📱 Nearby Devices ({devices.length}):</Text>
		{devices.length === 0 ? (
			<Box marginLeft={2} marginTop={1}>
				<Text color="gray">No devices found. Scanning...</Text>
			</Box>
		) : (
			devices.map((device, index) => (
				<Box key={`${device.ip}:${device.port}`} marginLeft={2} marginTop={1}>
					<Text color={selectedIndex === index ? "black" : "white"}
					      backgroundColor={selectedIndex === index ? "cyan" : undefined}>
						{selectedIndex === index ? "▶ " : "  "}
						{device.alias} ({device.ip}:{device.port})
						<Text color="gray"> - {device.deviceModel}</Text>
					</Text>
				</Box>
			))
		)}
		{devices.length > 0 && (
			<Box marginTop={1}>
				<Text color="gray">↑↓ Navigate | Enter: Select | Esc: Back</Text>
			</Box>
		)}
	</Box>
)

const MainMenu: React.FC<{ selectedIndex: number }> = ({ selectedIndex }) => {
	const menuItems = [
		{ key: '1', label: 'View & Select Devices', icon: '📱' },
		{ key: '2', label: 'Send Text Message', icon: '📝' },
		{ key: '3', label: 'Send File', icon: '📁' },
		{ key: '4', label: 'Start Receiver Mode', icon: '📥' },
		{ key: '5', label: 'Settings', icon: '⚙️' },
		{ key: '6', label: 'Exit', icon: '🚪' },
	]

	return (
		<Box flexDirection="column" marginY={1}>
			<Text color="yellow" bold>Main Menu:</Text>
			{menuItems.map((item, index) => (
				<Box key={item.key} marginLeft={2} marginTop={1}>
					<Text color={selectedIndex === index ? "black" : "white"}
					      backgroundColor={selectedIndex === index ? "cyan" : undefined}>
						{selectedIndex === index ? "▶ " : "  "}
						{item.icon} {item.label}
					</Text>
				</Box>
			))}
			<Box marginTop={1}>
				<Text color="gray">↑↓ Navigate | Enter: Select | q: Quit</Text>
			</Box>
		</Box>
	)
}

const SendTextScreen: React.FC<{ 
	device: DiscoveredDevice | null
	textInput: string
	onTextChange: (text: string) => void
	onSend: () => void
}> = ({ device, textInput, onTextChange: _onTextChange, onSend: _onSend }) => (
	<Box flexDirection="column" marginY={1}>
		<Text color="yellow" bold>📝 Send Text Message</Text>
		{device ? (
			<Box flexDirection="column" marginTop={1}>
				<Text>
					Target: <Text color="cyan">{device.alias}</Text> ({device.ip}:{device.port})
				</Text>
				<Box marginTop={1}>
					<Text>Message: </Text>
					<Text color="green">{textInput}</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="gray">Type your message and press Enter to send | Esc: Back</Text>
				</Box>
			</Box>
		) : (
			<Box marginTop={1}>
				<Text color="red">No device selected. Please select a device first.</Text>
				<Text color="gray">Esc: Back</Text>
			</Box>
		)}
	</Box>
)

const SendFileScreen: React.FC<{
	device: DiscoveredDevice | null
	fileInput: string
	onFileChange: (file: string) => void
	onSend: () => void
}> = ({ device, fileInput, onFileChange: _onFileChange, onSend: _onSend }) => (
	<Box flexDirection="column" marginY={1}>
		<Text color="yellow" bold>📁 Send File</Text>
		{device ? (
			<Box flexDirection="column" marginTop={1}>
				<Text>
					Target: <Text color="cyan">{device.alias}</Text> ({device.ip}:{device.port})
				</Text>
				<Box marginTop={1}>
					<Text>File path: </Text>
					<Text color="green">{fileInput}</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="gray">Type absolute file path and press Enter to send | Esc: Back</Text>
				</Box>
			</Box>
		) : (
			<Box marginTop={1}>
				<Text color="red">No device selected. Please select a device first.</Text>
				<Text color="gray">Esc: Back</Text>
			</Box>
		)}
	</Box>
)

const ReceiveScreen: React.FC<{
	isReceiving: boolean
	receivedFiles: Array<{ fileName: string; size: number; time: string; type: string }>
	onStop: () => void
}> = ({ isReceiving, receivedFiles, onStop: _onStop }) => (
	<Box flexDirection="column" marginY={1}>
		<Text color="yellow" bold>📥 Receiver Mode</Text>
		<Box marginTop={1}>
			<Text>
				Status: <Text color={isReceiving ? "green" : "red"}>
					{isReceiving ? "🟢 Listening for incoming transfers" : "🔴 Stopped"}
				</Text>
			</Text>
		</Box>
		
		{receivedFiles.length > 0 && (
			<Box flexDirection="column" marginTop={1}>
				<Text color="cyan" bold>Recent transfers:</Text>
				{receivedFiles.slice(-5).map((file, index) => (
					<Box key={index} marginLeft={2}>
						<Text>
							📄 {file.fileName} ({prettyBytes(file.size)}) - {file.time}
						</Text>
					</Box>
				))}
			</Box>
		)}
		
		<Box marginTop={1}>
			<Text color="gray">
				{isReceiving ? "r: Stop receiver" : "r: Start receiver"} | Esc: Back
			</Text>
		</Box>
	</Box>
)

const LocalSendTUI: React.FC<{ initialPort?: number; initialAlias?: string }> = ({ 
	initialPort, 
	initialAlias 
}) => {
	const { exit } = useApp()
	
	// State
	const [state, setState] = useState<AppState>({
		screen: 'main',
		selectedDeviceIndex: 0,
		devices: [],
		deviceInfo: getDeviceInfo({
			alias: initialAlias || `LocalSend TUI ${Math.floor(100 + Math.random() * 900)}`,
			port: initialPort,
			enableDownloadApi: false
		}),
		isScanning: false,
		lastScanTime: null,
		sendMode: null,
		textInput: '',
		fileInput: '',
		isReceiving: false,
		receivedFiles: []
	})

	const [selectedMenuIndex, setSelectedMenuIndex] = useState(0)
	const [discovery, setDiscovery] = useState<any>(null)
	const [httpDiscovery, setHttpDiscovery] = useState<any>(null)
	const [server, setServer] = useState<LocalSendHonoServer | null>(null)
	const [scanInterval, setScanInterval] = useState<NodeJS.Timeout | null>(null)

	// Device scanning
	const startScanning = useCallback(async () => {
		if (state.isScanning) return

		setState(prev => ({ ...prev, isScanning: true }))

		try {
			// Start multicast discovery
			const disc = createDiscovery(state.deviceInfo)
			disc.onDeviceDiscovered((device: any) => {
				// Multicast discovery should include IP information
				if (device.ip) {
					const discoveredDevice: DiscoveredDevice = device as DiscoveredDevice
					setState(prev => {
						const exists = prev.devices.some(d => `${d.ip}:${d.port}` === `${discoveredDevice.ip}:${discoveredDevice.port}`)
						if (!exists) {
							return {
								...prev,
								devices: [...prev.devices, discoveredDevice],
								lastScanTime: new Date()
							}
						}
						return prev
					})
				}
			})

			await disc.start()
			setDiscovery(disc)

			// Start HTTP discovery
			const httpDisc = createScanner(state.deviceInfo)
			httpDisc.onDeviceDiscovered((device: any) => {
				// HTTP discovery should include IP information
				if (device.ip) {
					const discoveredDevice: DiscoveredDevice = device as DiscoveredDevice
					setState(prev => {
						const exists = prev.devices.some(d => `${d.ip}:${d.port}` === `${discoveredDevice.ip}:${discoveredDevice.port}`)
						if (!exists) {
							return {
								...prev,
								devices: [...prev.devices, discoveredDevice],
								lastScanTime: new Date()
							}
						}
						return prev
					})
				}
			})

			setHttpDiscovery(httpDisc)
			await httpDisc.startScan?.()

			// Set up periodic scanning
			const interval = setInterval(() => {
				httpDisc.startScan?.().catch(() => {})
			}, 5000)
			setScanInterval(interval)

		} catch (error) {
			// Handle error silently
		} finally {
			setState(prev => ({ ...prev, isScanning: false, lastScanTime: new Date() }))
		}
	}, [state.deviceInfo, state.isScanning])

	const stopScanning = useCallback(() => {
		if (discovery) {
			discovery.stop()
			setDiscovery(null)
		}
		if (scanInterval) {
			clearInterval(scanInterval)
			setScanInterval(null)
		}
		setState(prev => ({ ...prev, isScanning: false }))
	}, [discovery, scanInterval])

	// Start scanning on mount
	useEffect(() => {
		startScanning()
		return () => {
			stopScanning()
		}
	}, [])

	// Input handling
	useInput((input, key) => {
		// Global shortcuts
		if (input === 'q' && state.screen === 'main') {
			exit()
			return
		}

		if (key.escape) {
			if (state.screen === 'main') {
				exit()
			} else {
				setState(prev => ({ ...prev, screen: 'main' }))
				setSelectedMenuIndex(0)
			}
			return
		}

		// Screen-specific input handling
		switch (state.screen) {
			case 'main':
				if (key.upArrow) {
					setSelectedMenuIndex(prev => (prev > 0 ? prev - 1 : 5))
				} else if (key.downArrow) {
					setSelectedMenuIndex(prev => (prev < 5 ? prev + 1 : 0))
				} else if (key.return) {
					switch (selectedMenuIndex) {
						case 0:
							setState(prev => ({ ...prev, screen: 'devices' }))
							break
						case 1:
							setState(prev => ({ ...prev, screen: 'send-text', sendMode: 'text' }))
							break
						case 2:
							setState(prev => ({ ...prev, screen: 'send-file', sendMode: 'file' }))
							break
						case 3:
							setState(prev => ({ ...prev, screen: 'receive' }))
							break
						case 4:
							setState(prev => ({ ...prev, screen: 'settings' }))
							break
						case 5:
							exit()
							break
					}
				}
				break

			case 'devices':
				if (key.upArrow && state.devices.length > 0) {
					setState(prev => ({
						...prev,
						selectedDeviceIndex: prev.selectedDeviceIndex > 0 
							? prev.selectedDeviceIndex - 1 
							: prev.devices.length - 1
					}))
				} else if (key.downArrow && state.devices.length > 0) {
					setState(prev => ({
						...prev,
						selectedDeviceIndex: prev.selectedDeviceIndex < prev.devices.length - 1
							? prev.selectedDeviceIndex + 1
							: 0
					}))
				} else if (key.return && state.devices.length > 0) {
					// Device selected - could go to send menu or just go back
					setState(prev => ({ ...prev, screen: 'main' }))
				}
				break

			case 'send-text':
				if (key.return && state.textInput.trim()) {
					// Send text logic here
					setState(prev => ({ ...prev, textInput: '', screen: 'main' }))
				} else if (key.backspace) {
					setState(prev => ({ ...prev, textInput: prev.textInput.slice(0, -1) }))
				} else if (input && !key.ctrl) {
					setState(prev => ({ ...prev, textInput: prev.textInput + input }))
				}
				break

			case 'send-file':
				if (key.return && state.fileInput.trim()) {
					// Send file logic here
					setState(prev => ({ ...prev, fileInput: '', screen: 'main' }))
				} else if (key.backspace) {
					setState(prev => ({ ...prev, fileInput: prev.fileInput.slice(0, -1) }))
				} else if (input && !key.ctrl) {
					setState(prev => ({ ...prev, fileInput: prev.fileInput + input }))
				}
				break

			case 'receive':
				if (input === 'r') {
					setState(prev => ({ ...prev, isReceiving: !prev.isReceiving }))
				}
				break
		}
	})

	// Render current screen
	const renderScreen = () => {
		const selectedDevice = state.devices.length > 0 ? state.devices[state.selectedDeviceIndex] : null

		switch (state.screen) {
			case 'devices':
				return (
					<DeviceList
						devices={state.devices}
						selectedIndex={state.selectedDeviceIndex}
						onSelect={(index) => setState(prev => ({ ...prev, selectedDeviceIndex: index }))}
					/>
				)
			case 'send-text':
				return (
					<SendTextScreen
						device={selectedDevice}
						textInput={state.textInput}
						onTextChange={(text) => setState(prev => ({ ...prev, textInput: text }))}
						onSend={() => {}}
					/>
				)
			case 'send-file':
				return (
					<SendFileScreen
						device={selectedDevice}
						fileInput={state.fileInput}
						onFileChange={(file) => setState(prev => ({ ...prev, fileInput: file }))}
						onSend={() => {}}
					/>
				)
			case 'receive':
				return (
					<ReceiveScreen
						isReceiving={state.isReceiving}
						receivedFiles={state.receivedFiles}
						onStop={() => setState(prev => ({ ...prev, isReceiving: false }))}
					/>
				)
			case 'settings':
				return (
					<Box flexDirection="column" marginY={1}>
						<Text color="yellow" bold>⚙️ Settings</Text>
						<Box marginTop={1}>
							<Text>Device: <Text color="cyan">{state.deviceInfo.alias}</Text></Text>
						</Box>
						<Box marginTop={1}>
							<Text>Port: <Text color="cyan">{state.deviceInfo.port}</Text></Text>
						</Box>
						<Box marginTop={1}>
							<Text color="gray">Esc: Back</Text>
						</Box>
					</Box>
				)
			default:
				return <MainMenu selectedIndex={selectedMenuIndex} />
		}
	}

	return (
		<Box flexDirection="column" minHeight={24}>
			<Header 
				title={state.screen === 'main' ? 'Main Menu' : state.screen.charAt(0).toUpperCase() + state.screen.slice(1)}
				deviceName={state.deviceInfo.alias} 
				port={state.deviceInfo.port} 
			/>
			{renderScreen()}
			<StatusBar 
				isScanning={state.isScanning}
				lastScanTime={state.lastScanTime}
				deviceCount={state.devices.length}
			/>
		</Box>
	)
}

const main = defineCommand({
	meta: {
		name: "localsend-tui",
		version: "0.1.0",
		description: "LocalSend Interactive TUI"
	},
	args: {
		port: {
			type: "string",
			description: "Custom port number"
		},
		alias: {
			type: "string",
			description: "Custom device alias"
		}
	},
	async run({ args }) {
		const portString = args.port as string | undefined
		const port = portString ? parseInt(portString, 10) : undefined
		const alias = args.alias as string | undefined

		render(<LocalSendTUI initialPort={port} initialAlias={alias} />)
	}
})

runMain(main)