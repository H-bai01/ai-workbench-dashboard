import { installBrowserErrorPrivacy, installPrivacyConsole } from './utils/log-privacy.mjs'

installPrivacyConsole(console, { scope: 'browser' })
installBrowserErrorPrivacy(window, console, { scope: 'browser' })
