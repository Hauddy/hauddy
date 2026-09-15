import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import App from './App';
export { PAGES, SITE_ORIGIN, SOCIAL_IMAGE } from './pages';

export function render(pathname: string) {
  return renderToString(<StrictMode><App pathname={pathname} /></StrictMode>);
}
