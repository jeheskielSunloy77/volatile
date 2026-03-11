import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './app/App'
import { AppProviders } from './app/providers'
import { StartupGateProvider } from './app/startup-gate'
import './styles/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
	throw new Error('Root element not found.')
}

createRoot(rootElement).render(
	<React.StrictMode>
		<AppProviders>
			<StartupGateProvider>
				<HashRouter>
					<App />
				</HashRouter>
			</StartupGateProvider>
		</AppProviders>
	</React.StrictMode>,
)
