import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authApiSrc = fs.readFileSync(path.join(__dirname, '../src/api/auth.js'), 'utf8');
const authCtxSrc = fs.readFileSync(path.join(__dirname, '../src/context/AuthContext.jsx'), 'utf8');
const googleBtnSrc = fs.readFileSync(path.join(__dirname, '../src/components/auth/GoogleAuthButton.jsx'), 'utf8');
const loginSrc = fs.readFileSync(path.join(__dirname, '../src/pages/LoginPage.jsx'), 'utf8');
const registerSrc = fs.readFileSync(path.join(__dirname, '../src/pages/RegisterPage.jsx'), 'utf8');

test('Google Authentication Frontend Integration & Custom UI Preservation', () => {
  for (const fn of ['getGoogleConfig', 'googleAuth', 'googleRegister']) {
    assert.ok(authApiSrc.includes(fn), `Missing ${fn} in authApi`);
  }
  assert.ok(authCtxSrc.includes('loginWithGoogle'));
  assert.ok(authCtxSrc.includes('registerWithGoogle'));
  assert.ok(googleBtnSrc.includes('GoogleLogo'));
  assert.ok(googleBtnSrc.includes('window.google?.accounts?.id'));

  assert.ok(loginSrc.includes('Continue with Google'));
  assert.ok(loginSrc.includes('ACCOUNT_NOT_REGISTERED'));
  assert.ok(loginSrc.includes('Sign In to MilJor'));

  assert.ok(registerSrc.includes('Sign up with Google'));
  assert.ok(registerSrc.includes('validateGoogleProfileFields'));
  assert.ok(registerSrc.includes('activateRegisterExactPreview'));
  assert.ok(registerSrc.includes('Create your MilJor account'));
});
