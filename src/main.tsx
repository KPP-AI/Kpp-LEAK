import 'leaflet/dist/leaflet.css';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (
  import.meta.env.DEV &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator
) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      const scriptUrl =
        registration.active?.scriptURL ||
        registration.waiting?.scriptURL ||
        registration.installing?.scriptURL ||
        '';
      if (scriptUrl.includes('dev-sw')) {
        void registration.unregister();
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
