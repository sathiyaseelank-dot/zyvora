import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';

import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { RequireAdmin, RequireAnonymous, RequireAuth } from './components/RequireAuth';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AccountPage } from './pages/AccountPage';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CraftPage } from './pages/CraftPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';

/**
 * Route table.
 *
 * `main` carries `id="main"` and `tabIndex={-1}` so the skip link has a real
 * target: it moves focus there, not just the viewport, which is what a screen
 * reader needs in order to start reading from the top of the content rather
 * than the banner.
 */
export function App() {
  const [title, setTitle] = useState('ZYVORA — Premium Car & Bike Flags');

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          {/*
            ZYV-106. The catalogue linked here before this route existed, so
            every product card was a dead link to the 404 page.
          */}
          <Route
            path="/products/:id"
            element={<ProductDetailPage onTitle={setTitle} />}
          />
          <Route path="/cart" element={<CartPage />} />
          {/* Was rendering <CatalogPage /> under the "Craft" label. */}
          <Route path="/about" element={<CraftPage />} />

          <Route
            path="/login"
            element={
              <RequireAnonymous>
                <LoginPage />
              </RequireAnonymous>
            }
          />
          <Route
            path="/register"
            element={
              <RequireAnonymous>
                <RegisterPage />
              </RequireAnonymous>
            }
          />
          {/* Reachable while signed in — a signed-out user may still need it. */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/account"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />

          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminDashboardPage onTitle={setTitle} />
              </RequireAdmin>
            }
          />

          <Route path="*" element={<NotFoundPage onTitle={setTitle} />} />
        </Routes>
      </main>

      <Footer />
    </div>
  );
}
