import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/dm-mono/400.css'
import '../../src/styles.css'
import '../../src/design.css'
import '../../src/polish.css'
import '../../src/theme.css'
import '../../src/admin.css'
import '../../src/admin-v2.css'
import { AdminAccessDenied, AdminLogin } from '../../src/features/auth/AuthScreens'
const view = location.hash.replace('#', '')
createRoot(document.getElementById('root')!).render(view === 'denied' ? <AdminAccessDenied email="ops@zerobyte.app" onBack={() => {}} /> : <AdminLogin />)
