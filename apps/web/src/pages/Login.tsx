// Router expects ./pages/Login.js — this thin re-export keeps the router
// import path stable while the real page lives in the login feature folder.
export { default } from '../features/auth/login/LoginPage';
