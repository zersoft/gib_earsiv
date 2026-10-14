/**
 * GİB e-Arşiv Fatura Portalı & Entegrasyon Kokpiti Frontend JS
 */

// ==========================================
// 0. Oturum Yönetimi & Global API Interceptor
// ==========================================
const AUTH_TOKEN_KEY = 'gib_auth_token';
const AUTH_USER_KEY = 'gib_auth_user';

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthSession(token, user) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }
  if (user) {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  }
  updateUserInterface(user);
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  updateUserInterface(null);
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getUser() {
  return getStoredUser();
}

// Global fetch wrapper (JWT Bearer enjeksiyonu ve 401 yönetimi)
const originalFetch = window.fetch;
window.fetch = async function(resource, init = {}) {
  const token = getToken();
  if (token && typeof resource === 'string' && resource.startsWith('/api')) {
    init = init || {};
    init.headers = init.headers || {};
    if (init.headers instanceof Headers) {
      if (!init.headers.has('Authorization')) {
        init.headers.append('Authorization', `Bearer ${token}`);
      }
    } else if (Array.isArray(init.headers)) {
      init.headers.push(['Authorization', `Bearer ${token}`]);
    } else {
      if (!init.headers['Authorization']) {
        init.headers['Authorization'] = `Bearer ${token}`;
      }
    }
  }

  const response = await originalFetch(resource, init);

  // 401 Yetkisiz durumunda login ekranını tetikle
  if (response.status === 401) {
    const isLoginEndpoint = typeof resource === 'string' && resource.includes('/api/auth/login');
    if (!isLoginEndpoint) {
      clearAuthSession();
      showLoginModal('Oturum süreniz doldu veya giriş yapmanız gerekiyor.');
    }
  }

  return response;
};

function updateUserInterface(user) {
  const userProfileBadge = document.getElementById('userProfileBadge');
  const navUserName = document.getElementById('navUserName');
  const navUserRole = document.getElementById('navUserRole');
  const btnLogout = document.getElementById('btnLogout');
  const btnOpenChangePassword = document.getElementById('btnOpenChangePassword');
  const loginOverlay = document.getElementById('loginOverlay');
  const btnDownloadTemplate = document.getElementById('btnDownloadTemplate');
  const navCompanyBar = document.getElementById('navCompanyBar');
  const tabBtnApi = document.getElementById('tabBtnApi');

  if (user && getToken()) {
    if (userProfileBadge) userProfileBadge.style.display = 'inline-flex';
    if (navUserName) navUserName.textContent = user.name || user.username;
    const dropdownUserName = document.getElementById('dropdownUserName');
    if (dropdownUserName) dropdownUserName.textContent = user.name || user.username;

    // Rol Yönetimi ve Yetkilendirme
    const isAdmin = (user.role === 'admin');
    if (navUserRole) {
      navUserRole.textContent = isAdmin ? 'Yönetici' : 'Mali Müşavir';
      navUserRole.className = isAdmin ? 'user-role-pill admin' : 'user-role-pill user';
    }

    // Kullanıcı rolü API entegrasyon kılavuzunu görmesin!
    if (tabBtnApi) {
      tabBtnApi.style.display = isAdmin ? 'inline-flex' : 'none';
      if (!isAdmin) {
        const tabApiContent = document.getElementById('tab-api');
        if (tabApiContent && tabApiContent.classList.contains('active')) {
          tabApiContent.classList.remove('active');
          tabBtnApi.classList.remove('active');
          const firstTab = document.querySelector('.tab-btn[data-tab="tab-create"]');
          if (firstTab) firstTab.click();
        }
      }
    }

    // Yalnızca Sistem Yöneticisi Kullanıcıları Yönetebilir!
    const tabBtnUsers = document.getElementById('tabBtnUsers');
    if (tabBtnUsers) {
      tabBtnUsers.style.display = isAdmin ? 'inline-flex' : 'none';
      if (!isAdmin) {
        const tabUsersContent = document.getElementById('tab-users');
        if (tabUsersContent && tabUsersContent.classList.contains('active')) {
          tabUsersContent.classList.remove('active');
          tabBtnUsers.classList.remove('active');
          const firstTab = document.querySelector('.tab-btn[data-tab="tab-create"]');
          if (firstTab) firstTab.click();
        }
      }
    }

    if (navCompanyBar) navCompanyBar.style.display = 'flex';
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (btnDownloadTemplate) {
      btnDownloadTemplate.href = `/api/bulk/template?token=${encodeURIComponent(getToken())}`;
    }
  } else {
    if (userProfileBadge) userProfileBadge.style.display = 'none';
    const userDropdownMenu = document.getElementById('userDropdownMenu');
    if (userDropdownMenu) userDropdownMenu.classList.remove('show');
    if (navCompanyBar) navCompanyBar.style.display = 'none';
    if (loginOverlay) loginOverlay.classList.remove('hidden');
  }
}

function showLoginModal(errorMsg = '') {
  const loginOverlay = document.getElementById('loginOverlay');
  const loginAlert = document.getElementById('loginAlert');
  const loginAlertMsg = document.getElementById('loginAlertMsg');

  if (loginOverlay) loginOverlay.classList.remove('hidden');
  if (errorMsg) {
    if (loginAlert) loginAlert.style.display = 'flex';
    if (loginAlertMsg) loginAlertMsg.textContent = errorMsg;
  } else {
    if (loginAlert) loginAlert.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elemanları
  const statusIndicator = document.getElementById('gibStatusIndicator');
  const statusText = document.getElementById('statusText');
  const btnRefreshStatus = document.getElementById('btnRefreshStatus');
  const btnOpenSettings = document.getElementById('btnOpenSettings');

  // Giriş & Kullanıcı Elemanları
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const btnTogglePass = document.getElementById('btnTogglePass');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  const btnLogout = document.getElementById('btnLogout');
  const btnDownloadTemplate = document.getElementById('btnDownloadTemplate');
  const btnOpenChangePassword = document.getElementById('btnOpenChangePassword');
  const userProfileBadge = document.getElementById('userProfileBadge');
  const modalChangePassword = document.getElementById('modalChangePassword');
  const changePasswordForm = document.getElementById('changePasswordForm');
  const pwdCurrent = document.getElementById('pwdCurrent');
  const pwdNew = document.getElementById('pwdNew');
  const pwdConfirm = document.getElementById('pwdConfirm');
  const btnSubmitChangePassword = document.getElementById('btnSubmitChangePassword');

  // Mükellefler & Çoklu Firma Elemanları
  const activeCompanySelect = document.getElementById('activeCompanySelect');
  const btnQuickAddCompany = document.getElementById('btnQuickAddCompany');
  const btnOpenAddCompanyModal = document.getElementById('btnOpenAddCompanyModal');
  const companiesTableBody = document.getElementById('companiesTableBody');
  const companiesCountBadge = document.getElementById('companiesCountBadge');
  const modalCompany = document.getElementById('modalCompany');
  const companyForm = document.getElementById('companyForm');
  const compEditId = document.getElementById('compEditId');
  const compName = document.getElementById('compName');
  const compVkn = document.getElementById('compVkn');
  const compVergiDairesi = document.getElementById('compVergiDairesi');
  const compGibUser = document.getElementById('compGibUser');
  const compGibPass = document.getElementById('compGibPass');
  const compPhone = document.getElementById('compPhone');
  const compEmail = document.getElementById('compEmail');
  const compAddress = document.getElementById('compAddress');
  const modalCompanyTitle = document.getElementById('modalCompanyTitle');
  const thCompAssignedUser = document.getElementById('thCompAssignedUser');
  const compAssignedUserGroup = document.getElementById('compAssignedUserGroup');
  const compAssignedUser = document.getElementById('compAssignedUser');

  // Kullanıcı Yönetimi Elemanları (Sistem Yöneticisi)
  const usersTableBody = document.getElementById('usersTableBody');
  const btnOpenAddUserModal = document.getElementById('btnOpenAddUserModal');
  const modalUser = document.getElementById('modalUser');
  const modalUserTitle = document.getElementById('modalUserTitle');
  const userForm = document.getElementById('userForm');
  const userEditId = document.getElementById('userEditId');
  const userUsername = document.getElementById('userUsername');
  const userName = document.getElementById('userName');
  const userPassword = document.getElementById('userPassword');
  const userPassReq = document.getElementById('userPassReq');
  const userPassHint = document.getElementById('userPassHint');
  const userRole = document.getElementById('userRole');
  const userCompany = document.getElementById('userCompany');
  const btnSaveUser = document.getElementById('btnSaveUser');
  const usersCountBadge = document.getElementById('usersCountBadge');

  // Sekmeler
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const invoicesCountBadge = document.getElementById('invoicesCountBadge');

  // Fatura Formu & Kalemler
  const invoiceForm = document.getElementById('invoiceForm');
  const vknTcknInput = document.getElementById('vknTckn');
  const btnQueryMernis = document.getElementById('btnQueryMernis');
  const aliciUnvanInput = document.getElementById('aliciUnvan');
  const aliciAdiInput = document.getElementById('aliciAdi');
  const aliciSoyadiInput = document.getElementById('aliciSoyadi');
  const aliciVergiDairesiInput = document.getElementById('aliciVergiDairesi');
  const aliciEmailInput = document.getElementById('aliciEmail');
  const aliciTelInput = document.getElementById('aliciTel');
  const aliciAdresInput = document.getElementById('aliciAdres');
  const faturaNotInput = document.getElementById('faturaNot');
  const itemsTableBody = document.getElementById('itemsTableBody');
  const btnAddItem = document.getElementById('btnAddItem');
  const btnResetForm = document.getElementById('btnResetForm');
  const btnCreateDraft = document.getElementById('btnCreateDraft');

  // Özet Tutarlar
  const sumMatrah = document.getElementById('sumMatrah');
  const sumKdv = document.getElementById('sumKdv');
  const sumGenelToplam = document.getElementById('sumGenelToplam');
  const sumYaziyla = document.getElementById('sumYaziyla');

  // Liste, Filtreler ve Senkronizasyon
  const filterStartDate = document.getElementById('filterStartDate');
  const filterEndDate = document.getElementById('filterEndDate');
  const filterSearch = document.getElementById('filterSearch');
  const filterStatus = document.getElementById('filterStatus');
  const btnFilterApply = document.getElementById('btnFilterApply');
  const btnSyncGib = document.getElementById('btnSyncGib');
  const invoicesTableBody = document.getElementById('invoicesTableBody');

  // KPI Dashboard Elementleri
  const kpiApprovedAmount = document.getElementById('kpiApprovedAmount');
  const kpiApprovedCount = document.getElementById('kpiApprovedCount');
  const kpiApprovedKdv = document.getElementById('kpiApprovedKdv');
  const kpiApprovedMatrah = document.getElementById('kpiApprovedMatrah');
  const kpiDraftCount = document.getElementById('kpiDraftCount');
  const kpiSyncStatus = document.getElementById('kpiSyncStatus');
  const kpiLastSync = document.getElementById('kpiLastSync');

  // Modallar
  const modalPreview = document.getElementById('modalPreview');
  const previewIframe = document.getElementById('previewIframe');
  const btnPrintInvoice = document.getElementById('btnPrintInvoice');

  const modalSmsSign = document.getElementById('modalSmsSign');
  const registeredPhoneNumber = document.getElementById('registeredPhoneNumber');
  const btnTriggerSms = document.getElementById('btnTriggerSms');
  const smsStep1 = document.getElementById('smsStep1');
  const smsStep2 = document.getElementById('smsStep2');
  const smsInputCode = document.getElementById('smsInputCode');
  const btnConfirmSign = document.getElementById('btnConfirmSign');

  const modalSendEmail = document.getElementById('modalSendEmail');
  const sendEmailForm = document.getElementById('sendEmailForm');
  const emailToInput = document.getElementById('emailTo');
  const emailSubjectInput = document.getElementById('emailSubject');

  const modalSettings = document.getElementById('modalSettings');
  const settingsForm = document.getElementById('settingsForm');

  // Aktif İşlem Değişkenleri
  let currentSigningItem = null;
  let currentEmailItem = null;
  let activeSmsOid = null;

  // ==========================================
  // 1. Sekme Yönetimi
  // ==========================================
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');

      if (btn.dataset.tab === 'tab-list') {
        loadInvoices();
      } else if (btn.dataset.tab === 'tab-companies') {
        loadCompanies();
      } else if (btn.dataset.tab === 'tab-users') {
        loadUsers();
      }
    });
  });

  // Modal Kapatma
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.close;
      closeModal(modalId);
    });
  });

  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('active');
    }
  });

  function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
  }

  // ==========================================
  // 1.1 Oturum & Giriş Olayları
  // ==========================================
  if (btnTogglePass && loginPassword) {
    btnTogglePass.addEventListener('click', () => {
      const isPassword = loginPassword.type === 'password';
      loginPassword.type = isPassword ? 'text' : 'password';
      btnTogglePass.innerHTML = isPassword 
        ? '<i class="fa-solid fa-eye-slash"></i>' 
        : '<i class="fa-solid fa-eye"></i>';
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = loginUsername.value.trim();
      const password = loginPassword.value;
      const loginAlert = document.getElementById('loginAlert');
      const loginAlertMsg = document.getElementById('loginAlertMsg');

      if (!username || !password) return;

      const btnText = btnLoginSubmit.querySelector('.btn-text');
      const spinner = btnLoginSubmit.querySelector('.spinner-sm');
      btnLoginSubmit.disabled = true;
      if (btnText) btnText.style.display = 'none';
      if (spinner) spinner.style.display = 'inline-block';
      if (loginAlert) loginAlert.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (data.success && data.token) {
          setAuthSession(data.token, data.user);
          showToast(`Hoş geldiniz, ${data.user.name || data.user.username}!`, 'success');
          loadCompanies();
          checkGibStatus();
          loadDashboardStats();
          if (document.querySelector('.tab-btn.active[data-tab="tab-list"]')) {
            loadInvoices();
          }
        } else {
          if (loginAlert) loginAlert.style.display = 'flex';
          if (loginAlertMsg) loginAlertMsg.textContent = data.error || 'Kullanıcı adı veya şifre hatalı.';
        }
      } catch (err) {
        if (loginAlert) loginAlert.style.display = 'flex';
        if (loginAlertMsg) loginAlertMsg.textContent = 'Bağlantı hatası: ' + err.message;
      } finally {
        btnLoginSubmit.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (spinner) spinner.style.display = 'none';
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        // ignore
      }
      clearAuthSession();
      showToast('Oturum kapatıldı.', 'info');
      showLoginModal();
    });
  }

  if (btnDownloadTemplate) {
    btnDownloadTemplate.addEventListener('click', () => {
      const token = getToken();
      if (token) {
        btnDownloadTemplate.href = `/api/bulk/template?token=${encodeURIComponent(token)}`;
      }
    });
  }

  // ==========================================
  // 1.1 Şifre Değiştirme (Kullanıcı & Yönetici)
  // ==========================================
  function openChangePasswordModal() {
    if (changePasswordForm) changePasswordForm.reset();
    openModal('modalChangePassword');
    setTimeout(() => {
      if (pwdCurrent) pwdCurrent.focus();
    }, 150);
  }

  if (btnOpenChangePassword) {
    btnOpenChangePassword.addEventListener('click', openChangePasswordModal);
  }

  // Kullanıcı Profili Dropdown Menü Aç/Kapat & Dışarı Tıklama
  const userDropdownMenu = document.getElementById('userDropdownMenu');
  if (userProfileBadge && userDropdownMenu) {
    userProfileBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = userDropdownMenu.classList.toggle('show');
      userProfileBadge.classList.toggle('active', isOpen);
      userProfileBadge.setAttribute('aria-expanded', isOpen);
    });

    document.addEventListener('click', (e) => {
      if (!userDropdownMenu.contains(e.target) && !userProfileBadge.contains(e.target)) {
        userDropdownMenu.classList.remove('show');
        userProfileBadge.classList.remove('active');
        userProfileBadge.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && userDropdownMenu.classList.contains('show')) {
        userDropdownMenu.classList.remove('show');
        userProfileBadge.classList.remove('active');
        userProfileBadge.setAttribute('aria-expanded', 'false');
      }
    });

    [btnOpenSettings, btnOpenChangePassword, btnLogout].forEach(el => {
      if (el) {
        el.addEventListener('click', () => {
          userDropdownMenu.classList.remove('show');
          userProfileBadge.classList.remove('active');
          userProfileBadge.setAttribute('aria-expanded', 'false');
        });
      }
    });
  }

  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = pwdCurrent.value;
      const newPassword = pwdNew.value;
      const confirmPassword = pwdConfirm.value;

      if (!currentPassword || !newPassword) {
        showToast('Mevcut şifre ve yeni şifre zorunludur.', 'warning');
        return;
      }

      if (newPassword.length < 4) {
        showToast('Yeni şifre en az 4 karakter olmalıdır.', 'warning');
        return;
      }

      if (newPassword !== confirmPassword) {
        showToast('Yeni şifre ve şifre tekrarı uyuşmuyor!', 'error');
        return;
      }

      if (btnSubmitChangePassword) btnSubmitChangePassword.disabled = true;

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
        });
        const data = await res.json();

        if (data.success) {
          showToast(data.message || 'Şifreniz başarıyla değiştirildi.', 'success');
          closeModal('modalChangePassword');
          changePasswordForm.reset();
        } else {
          showToast('Hata: ' + (data.error || 'Şifre değiştirilemedi.'), 'error');
        }
      } catch (err) {
        showToast('Bağlantı hatası: ' + err.message, 'error');
      } finally {
        if (btnSubmitChangePassword) btnSubmitChangePassword.disabled = false;
      }
    });
  }

  async function checkInitialAuth() {
    const token = getToken();
    const storedUser = getStoredUser();

    if (!token) {
      showLoginModal();
      return false;
    }

    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success && data.user) {
        setAuthSession(token, data.user);
        return true;
      } else {
        clearAuthSession();
        showLoginModal('Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.');
        return false;
      }
    } catch (err) {
      if (storedUser) {
        updateUserInterface(storedUser);
        return true;
      }
      showLoginModal();
      return false;
    }
  }

  // ==========================================
  // 1.2 Mükellefler & Çoklu Firma Yönetimi (Multi-Company)
  // ==========================================
  async function populateAssignUserDropdown(selectedUserId = null) {
    if (!compAssignedUser) return;
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      compAssignedUser.innerHTML = '<option value="">-- Herhangi Bir Kullanıcıya Atanmamış (Ortak / Sistem) --</option>';
      if (data.success && Array.isArray(data.data)) {
        data.data.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.id;
          const roleTxt = u.role === 'admin' ? 'Yönetici' : 'Mali Müşavir';
          opt.textContent = `${u.name || u.username} (@${u.username} - ${roleTxt})`;
          if (selectedUserId !== null && selectedUserId !== undefined && Number(selectedUserId) === Number(u.id)) {
            opt.selected = true;
          }
          compAssignedUser.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('[populateAssignUserDropdown] Kullanıcılar yüklenemedi:', err.message);
    }
  }

  async function loadCompanies() {
    try {
      const res = await fetch('/api/companies');
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data)) return;

      const companies = data.data;
      if (companiesCountBadge) companiesCountBadge.textContent = companies.length;

      const storedUser = getStoredUser();
      const isAdmin = Boolean(data.isAdmin || (storedUser && storedUser.role === 'admin'));

      if (thCompAssignedUser) {
        thCompAssignedUser.style.display = isAdmin ? 'table-cell' : 'none';
      }

      // 1. Navbar dropdown güncelle
      if (activeCompanySelect) {
        activeCompanySelect.innerHTML = '';
        companies.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.vkn_tckn || '-'})`;
          if (c.id === data.activeCompanyId || c.is_active === 1) {
            opt.selected = true;
          }
          activeCompanySelect.appendChild(opt);
        });
      }

      // 2. Tabloyu güncelle
      if (companiesTableBody) {
        companiesTableBody.innerHTML = '';
        if (companies.length === 0) {
          const emptyColspan = isAdmin ? 8 : 7;
          companiesTableBody.innerHTML = `<tr><td colspan="${emptyColspan}" style="text-align:center; padding:2rem; color:var(--gray-500);">Kayıtlı mükellef bulunamadı.</td></tr>`;
          return;
        }
        companies.forEach(c => {
          const isActive = (c.id === data.activeCompanyId || c.is_active === 1);
          const tr = document.createElement('tr');
          if (isActive) tr.style.backgroundColor = 'rgba(16, 185, 129, 0.04)';

          const assignedUserCell = isAdmin ? `
            <td>
              ${c.assigned_user_name 
                ? `<span class="user-role-pill user" title="@${escapeHtml(c.assigned_user_username || '')}"><i class="fa-solid fa-user-tie"></i> ${escapeHtml(c.assigned_user_name)}</span>` 
                : '<span style="color:var(--gray-400); font-size:0.8rem; font-style:italic;">Atanmamış</span>'
              }
            </td>
          ` : '';

          tr.innerHTML = `
            <td>
              ${isActive 
                ? '<span class="badge-active-comp"><i class="fa-solid fa-circle-check"></i> Aktif</span>' 
                : '<span class="badge-inactive-comp"><i class="fa-regular fa-circle"></i> Pasif</span>'
              }
            </td>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td><code>${escapeHtml(c.vkn_tckn || '-')}</code></td>
            <td>${escapeHtml(c.vergi_dairesi || '-')}</td>
            <td><code>${escapeHtml(c.gib_user || '-')}</code></td>
            ${assignedUserCell}
            <td>
              <small>${escapeHtml(c.phone || '')}${c.phone && c.email ? ' / ' : ''}${escapeHtml(c.email || '')}</small>
            </td>
            <td style="text-align: right; white-space: nowrap;">
              <div class="table-actions">
                ${!isActive 
                  ? `<button type="button" class="action-btn action-btn-select btn-activate-company" data-id="${c.id}" title="Bu mükellefe geç">
                       <i class="fa-solid fa-arrow-right-arrow-left"></i> Seç
                     </button>` 
                  : ''
                }
                <button type="button" class="action-btn action-btn-edit btn-edit-company" data-id="${c.id}" title="Mükellefi Düzenle">
                  <i class="fa-solid fa-pen-to-square"></i> Düzenle
                </button>
                <button type="button" class="action-btn action-btn-delete btn-del-company" data-id="${c.id}" title="Mükellefi Sil" ${companies.length <= 1 ? 'disabled' : ''}>
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </td>
          `;

          const actBtn = tr.querySelector('.btn-activate-company');
          if (actBtn) {
            actBtn.addEventListener('click', () => switchCompany(c.id, c.name));
          }

          const editBtn = tr.querySelector('.btn-edit-company');
          if (editBtn) {
            editBtn.addEventListener('click', () => openEditCompanyModal(c));
          }

          const delBtn = tr.querySelector('.btn-del-company');
          if (delBtn) {
            delBtn.addEventListener('click', () => deleteCompany(c.id, c.name));
          }

          companiesTableBody.appendChild(tr);
        });
      }
    } catch (err) {
      console.warn('[Company] Yükleme hatası:', err.message);
    }
  }

  async function switchCompany(id, name = '') {
    try {
      const res = await fetch(`/api/companies/${id}/activate`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Mükellef seçimi güncellendi.', 'success');
        await loadCompanies();
        await checkGibStatus();
        await loadInvoices();
        await loadDashboardStats();
      } else {
        showToast('Mükellef değiştirilemedi: ' + data.error, 'error');
      }
    } catch (err) {
      showToast('Bağlantı hatası: ' + err.message, 'error');
    }
  }

  function openAddCompanyModal() {
    compEditId.value = '';
    companyForm.reset();
    modalCompanyTitle.innerHTML = '<i class="fa-solid fa-building-circle-check text-primary"></i> Yeni Mükellef / Firma Ekle';
    
    const storedUser = getStoredUser();
    const isAdmin = storedUser && storedUser.role === 'admin';
    if (compAssignedUserGroup) {
      compAssignedUserGroup.style.display = isAdmin ? 'block' : 'none';
      if (isAdmin) {
        populateAssignUserDropdown(null);
      }
    }

    openModal('modalCompany');
  }

  function openEditCompanyModal(c) {
    compEditId.value = c.id;
    compName.value = c.name || '';
    compVkn.value = c.vkn_tckn || '';
    compVergiDairesi.value = c.vergi_dairesi || '';
    compGibUser.value = c.gib_user || '';
    compGibPass.value = '';
    compPhone.value = c.phone || '';
    compEmail.value = c.email || '';
    compAddress.value = c.address || '';
    modalCompanyTitle.innerHTML = `<i class="fa-solid fa-pen-to-square text-primary"></i> Mükellefi Düzenle - ${escapeHtml(c.name)}`;
    
    const storedUser = getStoredUser();
    const isAdmin = storedUser && storedUser.role === 'admin';
    if (compAssignedUserGroup) {
      compAssignedUserGroup.style.display = isAdmin ? 'block' : 'none';
      if (isAdmin) {
        populateAssignUserDropdown(c.user_id || null);
      }
    }

    openModal('modalCompany');
  }

  async function deleteCompany(id, name) {
    if (!confirm(`"${name}" mükellefini silmek istediğinize emin misiniz?`)) return;

    try {
      const res = await fetch(`/api/companies/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Mükellef silindi.', 'success');
        await loadCompanies();
        await checkGibStatus();
        await loadInvoices();
        await loadDashboardStats();
      } else {
        showToast('Silme hatası: ' + data.error, 'error');
      }
    } catch (err) {
      showToast('Bağlantı hatası: ' + err.message, 'error');
    }
  }

  // Navbar select değişikliği
  if (activeCompanySelect) {
    activeCompanySelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      if (selectedId) switchCompany(selectedId);
    });
  }

  if (btnQuickAddCompany) {
    btnQuickAddCompany.addEventListener('click', openAddCompanyModal);
  }

  if (btnOpenAddCompanyModal) {
    btnOpenAddCompanyModal.addEventListener('click', openAddCompanyModal);
  }

  // Mükellef Formu Kaydet
  if (companyForm) {
    companyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = compEditId.value;
      const payload = {
        name: compName.value.trim(),
        vkn_tckn: compVkn.value.trim(),
        vergi_dairesi: compVergiDairesi.value.trim(),
        gib_user: compGibUser.value.trim(),
        gib_pass: compGibPass.value,
        phone: compPhone.value.trim(),
        email: compEmail.value.trim(),
        address: compAddress.value.trim()
      };

      const storedUser = getStoredUser();
      if (storedUser && storedUser.role === 'admin' && compAssignedUser) {
        payload.user_id = compAssignedUser.value ? Number(compAssignedUser.value) : null;
      }

      const btnSave = document.getElementById('btnSaveCompany');
      if (btnSave) btnSave.disabled = true;

      try {
        const url = editId ? `/api/companies/${editId}` : '/api/companies';
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
          showToast(data.message || 'Mükellef başarıyla kaydedildi.', 'success');
          closeModal('modalCompany');
          await loadCompanies();
          await checkGibStatus();
          await loadInvoices();
          await loadDashboardStats();
        } else {
          showToast('Kayıt hatası: ' + data.error, 'error');
        }
      } catch (err) {
        showToast('Bağlantı hatası: ' + err.message, 'error');
      } finally {
        if (btnSave) btnSave.disabled = false;
      }
    });
  }

  // ==========================================
  // 1.3 Sistem Kullanıcıları Yönetimi (Admin Only)
  // ==========================================
  async function loadUsers() {
    const storedUser = getStoredUser();
    if (!storedUser || storedUser.role !== 'admin') {
      console.warn('[Users] Admin yetkisi yok veya kullanıcı oturumu bulunamadı:', storedUser);
      return;
    }

    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data)) {
        console.warn('[Users] API başarısız veya veri dizisi değil:', data);
        return;
      }

      const users = data.data;
      if (usersCountBadge) usersCountBadge.textContent = users.length;

      if (usersTableBody) {
        usersTableBody.innerHTML = '';
        if (users.length === 0) {
          usersTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--gray-500);">Kayıtlı kullanıcı bulunamadı.</td></tr>';
          return;
        }
        users.forEach(u => {
          const isCurrentUser = (storedUser && storedUser.id === u.id);
          const isPrimaryAdmin = (u.username === 'admin');
          const tr = document.createElement('tr');

          const roleBadge = (u.role === 'admin')
            ? '<span class="user-role-pill admin"><i class="fa-solid fa-shield-halved"></i> Sistem Yöneticisi</span>'
            : '<span class="user-role-pill user"><i class="fa-solid fa-user-tie"></i> Mali Müşavir / Kullanıcı</span>';

          const createdFormatted = u.created_at
            ? new Date(u.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '-';

          tr.innerHTML = `
            <td><code>#${u.id}</code></td>
            <td><strong>${escapeHtml(u.username)}</strong> ${isCurrentUser ? '<small style="color:var(--primary); font-weight:600;">(Siz)</small>' : ''}</td>
            <td>${escapeHtml(u.name || '-')}</td>
            <td>${roleBadge}</td>
            <td>${u.active_company_name ? escapeHtml(u.active_company_name) : '<span style="color:var(--gray-400);">-</span>'}</td>
            <td><small style="color:var(--gray-600);">${createdFormatted}</small></td>
            <td style="text-align: right; white-space: nowrap;">
              <div class="table-actions">
                <button type="button" class="action-btn action-btn-edit btn-edit-user" data-id="${u.id}" title="Kullanıcıyı Düzenle">
                  <i class="fa-solid fa-pen-to-square"></i> Düzenle
                </button>
                <button type="button" class="action-btn action-btn-delete btn-del-user" data-id="${u.id}" title="Kullanıcıyı Sil" ${(isCurrentUser || isPrimaryAdmin) ? 'disabled' : ''}>
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </td>
          `;

          const editBtn = tr.querySelector('.btn-edit-user');
          if (editBtn) {
            editBtn.addEventListener('click', () => openEditUserModal(u));
          }

          const delBtn = tr.querySelector('.btn-del-user');
          if (delBtn && !isCurrentUser && !isPrimaryAdmin) {
            delBtn.addEventListener('click', () => deleteUser(u.id, u.username));
          }

          usersTableBody.appendChild(tr);
        });
      }
    } catch (err) {
      console.warn('[Users] Yükleme hatası:', err.message);
    }
  }

  async function populateUserCompanyDropdown(selectedCompanyId = null) {
    if (!userCompany) return;
    userCompany.innerHTML = '<option value="">-- Varsayılan Mükellef Seçin (Opsiyonel) --</option>';
    try {
      const res = await fetch('/api/companies');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        data.data.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.vkn_tckn || '-'})`;
          if (selectedCompanyId && String(c.id) === String(selectedCompanyId)) {
            opt.selected = true;
          }
          userCompany.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('[CompanyDropdown] Yüklenemedi:', err.message);
    }
  }

  async function openAddUserModal() {
    if (userEditId) userEditId.value = '';
    if (userForm) userForm.reset();
    if (userUsername) {
      userUsername.disabled = false;
      userUsername.readOnly = false;
    }
    if (userPassword) userPassword.required = true;
    if (userPassReq) userPassReq.style.display = 'inline';
    if (userPassHint) userPassHint.style.display = 'none';
    if (modalUserTitle) modalUserTitle.innerHTML = '<i class="fa-solid fa-user-plus text-primary"></i> Yeni Kullanıcı Ekle';

    await populateUserCompanyDropdown();
    openModal('modalUser');
  }

  async function openEditUserModal(u) {
    if (userEditId) userEditId.value = u.id;
    if (userUsername) {
      userUsername.value = u.username;
      userUsername.disabled = true;
    }
    if (userName) userName.value = u.name || '';
    if (userPassword) {
      userPassword.value = '';
      userPassword.required = false;
    }
    if (userPassReq) userPassReq.style.display = 'none';
    if (userPassHint) userPassHint.style.display = 'block';
    if (userRole) userRole.value = u.role || 'user';
    if (modalUserTitle) modalUserTitle.innerHTML = `<i class="fa-solid fa-user-pen text-primary"></i> Kullanıcıyı Düzenle - ${escapeHtml(u.username)}`;

    await populateUserCompanyDropdown(u.active_company_id);
    openModal('modalUser');
  }

  async function deleteUser(id, username) {
    if (!confirm(`"${username}" kullanıcısını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) return;

    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Kullanıcı silindi.', 'success');
        await loadUsers();
      } else {
        showToast('Kullanıcı silinemedi: ' + data.error, 'error');
      }
    } catch (err) {
      showToast('Bağlantı hatası: ' + err.message, 'error');
    }
  }

  if (btnOpenAddUserModal) {
    btnOpenAddUserModal.addEventListener('click', openAddUserModal);
  }

  if (userForm) {
    userForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = userEditId.value;
      const payload = {
        name: userName.value.trim(),
        role: userRole.value,
        activeCompanyId: userCompany.value ? Number(userCompany.value) : null
      };

      if (!editId) {
        payload.username = userUsername.value.trim();
        payload.password = userPassword.value.trim();
      } else {
        if (userPassword.value.trim()) {
          payload.password = userPassword.value.trim();
        }
      }

      if (btnSaveUser) btnSaveUser.disabled = true;

      try {
        const url = editId ? `/api/users/${editId}` : '/api/users';
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
          showToast(data.message || 'Kullanıcı başarıyla kaydedildi.', 'success');
          closeModal('modalUser');
          await loadUsers();
        } else {
          showToast('Kullanıcı kayıt hatası: ' + data.error, 'error');
        }
      } catch (err) {
        showToast('Bağlantı hatası: ' + err.message, 'error');
      } finally {
        if (btnSaveUser) btnSaveUser.disabled = false;
      }
    });
  }

  // ==========================================
  // 2. GİB Durum Kontrolü
  // ==========================================
  async function checkGibStatus() {
    statusIndicator.className = 'nav-status';
    statusIndicator.innerHTML = `
      <span class="status-dot pulsing"></span>
      <span class="status-text">Kontrol Ediliyor...</span>
    `;
    statusIndicator.title = 'GİB Bağlantısı Kontrol Ediliyor...';

    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      if (data.success && data.gib && data.gib.connected) {
        statusIndicator.className = 'nav-status online';
        statusIndicator.innerHTML = `
          <span class="status-dot online"></span>
          <span class="status-text">GİB Çevrimiçi</span>
        `;
        statusIndicator.title = `GİB Oturumu Açık\nMükellef: ${data.gib.unvan || '-'}\nVKN/TCKN: ${data.gib.vkn || '-'}`;
      } else {
        statusIndicator.className = 'nav-status offline';
        statusIndicator.innerHTML = `
          <span class="status-dot offline"></span>
          <span class="status-text">GİB Çevrimdışı</span>
        `;
        statusIndicator.title = `GİB Bağlantısı Kurulamadı\n${data.gib ? data.gib.message : 'Bağlantı Yok'}`;
      }
    } catch (err) {
      statusIndicator.className = 'nav-status offline';
      statusIndicator.innerHTML = `
        <span class="status-dot offline"></span>
        <span class="status-text">Sunucu Hatası</span>
      `;
      statusIndicator.title = 'Sunucuya Ulaşılamadı: ' + err.message;
    }
  }

  if (btnRefreshStatus) {
    btnRefreshStatus.addEventListener('click', async () => {
      const icon = btnRefreshStatus.querySelector('i');
      if (icon) icon.classList.add('fa-spin');
      await checkGibStatus();
      setTimeout(() => {
        if (icon) icon.classList.remove('fa-spin');
      }, 500);
    });
  }

  // ==========================================
  // 3. Kalem Ekleme ve Hesaplama Motoru
  // ==========================================
  function createItemRow(desc = '', qty = 1, unit = 'ADET', price = 0, vat = 20) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="text" class="item-desc" placeholder="Hizmet / Ürün Adı" value="${escapeHtml(desc)}" required>
      </td>
      <td>
        <input type="number" class="item-qty" min="0.01" step="any" value="${qty}" required>
      </td>
      <td>
        <select class="item-unit">
          <option value="ADET" ${unit === 'ADET' ? 'selected' : ''}>Adet</option>
          <option value="AY" ${unit === 'AY' ? 'selected' : ''}>Ay</option>
          <option value="GÜN" ${unit === 'GÜN' ? 'selected' : ''}>Gün</option>
          <option value="SAAT" ${unit === 'SAAT' ? 'selected' : ''}>Saat</option>
          <option value="PAKET" ${unit === 'PAKET' ? 'selected' : ''}>Paket</option>
          <option value="KİLO" ${unit === 'KİLO' ? 'selected' : ''}>Kg</option>
        </select>
      </td>
      <td>
        <input type="number" class="item-price" min="0" step="0.01" value="${price}" required>
      </td>
      <td>
        <select class="item-vat">
          <option value="20" ${vat === 20 ? 'selected' : ''}>%20</option>
          <option value="10" ${vat === 10 ? 'selected' : ''}>%10</option>
          <option value="1" ${vat === 1 ? 'selected' : ''}>%1</option>
          <option value="0" ${vat === 0 ? 'selected' : ''}>%0</option>
        </select>
      </td>
      <td class="item-total-cell" style="font-weight: 600;">
        0.00 TL
      </td>
      <td style="text-align: center">
        <button type="button" class="btn-icon btn-remove-row" title="Kalemi Sil">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;

    // Değişiklik dinleyicileri
    const inputs = tr.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.addEventListener('input', calculateTotals);
    });

    tr.querySelector('.btn-remove-row').addEventListener('click', () => {
      if (itemsTableBody.children.length > 1) {
        tr.remove();
        calculateTotals();
      } else {
        showToast('En az bir hizmet kalemi bulunmalıdır.', 'error');
      }
    });

    itemsTableBody.appendChild(tr);
    calculateTotals();
  }

  btnAddItem.addEventListener('click', () => {
    createItemRow();
  });

  function calculateTotals() {
    let totalMatrah = 0;
    let totalKdv = 0;

    const rows = itemsTableBody.querySelectorAll('tr');
    rows.forEach(tr => {
      const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
      const price = parseFloat(tr.querySelector('.item-price').value) || 0;
      const vatRate = parseFloat(tr.querySelector('.item-vat').value) || 0;

      const lineMatrah = Math.round(qty * price * 100) / 100;
      const lineKdv = Math.round((lineMatrah * vatRate / 100) * 100) / 100;
      const lineTotal = lineMatrah + lineKdv;

      tr.querySelector('.item-total-cell').innerText = lineTotal.toFixed(2) + ' TL';

      totalMatrah += lineMatrah;
      totalKdv += lineKdv;
    });

    const genelToplam = totalMatrah + totalKdv;

    sumMatrah.innerText = totalMatrah.toFixed(2) + ' TL';
    sumKdv.innerText = totalKdv.toFixed(2) + ' TL';
    sumGenelToplam.innerText = genelToplam.toFixed(2) + ' TL';
    sumYaziyla.innerText = convertNumberToTurkishWords(genelToplam);
  }

  // ==========================================
  // 4. MERNİS & Vergi Dairesi Otomatik Sorgulama
  // ==========================================
  async function performMernisLookup() {
    const val = vknTcknInput.value.trim();
    if (!val || val.length < 10) {
      showToast('Lütfen en az 10 haneli VKN veya 11 haneli TCKN girin.', 'error');
      return;
    }

    btnQueryMernis.disabled = true;
    btnQueryMernis.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sorgulanıyor...';

    try {
      const res = await fetch('/api/query-mernis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vknTckn: val })
      });
      const data = await res.json();

      if (data.success && data.data) {
        const info = data.data;
        if (info.unvan) {
          aliciUnvanInput.value = info.unvan;
        }
        if (info.adi) aliciAdiInput.value = info.adi;
        if (info.soyadi) aliciSoyadiInput.value = info.soyadi;
        if (info.vergiDairesi) aliciVergiDairesiInput.value = info.vergiDairesi;

        showToast(`Müşteri bilgileri GİB MERNİS üzerinden çekildi: ${info.unvan || (info.adi + ' ' + info.soyadi)}`, 'success');
      } else {
        showToast(data.error || 'Sicil kaydı bulunamadı, bilgileri manuel giriniz.', 'error');
      }
    } catch (err) {
      showToast('Sorgulama hatası: ' + err.message, 'error');
    } finally {
      btnQueryMernis.disabled = false;
      btnQueryMernis.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> MERNİS\'ten Çek';
    }
  }

  btnQueryMernis.addEventListener('click', performMernisLookup);
  vknTcknInput.addEventListener('blur', () => {
    if (vknTcknInput.value.trim().length >= 10 && !aliciAdiInput.value && !aliciUnvanInput.value) {
      performMernisLookup();
    }
  });

  // ==========================================
  // 5. Yeni Fatura Taslağı Gönderme
  // ==========================================
  invoiceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const items = [];
    const rows = itemsTableBody.querySelectorAll('tr');
    rows.forEach(tr => {
      const malHizmet = tr.querySelector('.item-desc').value.trim();
      const miktar = parseFloat(tr.querySelector('.item-qty').value) || 1;
      const birim = tr.querySelector('.item-unit').value;
      const birimFiyat = parseFloat(tr.querySelector('.item-price').value) || 0;
      const kdvOrani = parseFloat(tr.querySelector('.item-vat').value) || 0;

      if (malHizmet && birimFiyat >= 0) {
        items.push({ malHizmet, miktar, birim, birimFiyat, kdvOrani });
      }
    });

    if (items.length === 0) {
      showToast('Lütfen en az bir geçerli fatura kalemi girin.', 'error');
      return;
    }

    const payload = {
      vknTckn: vknTcknInput.value.trim(),
      aliciUnvan: aliciUnvanInput.value.trim(),
      aliciAdi: aliciAdiInput.value.trim(),
      aliciSoyadi: aliciSoyadiInput.value.trim(),
      aliciVergiDairesi: aliciVergiDairesiInput.value.trim(),
      aliciEmail: aliciEmailInput.value.trim(),
      aliciTel: aliciTelInput.value.trim(),
      aliciAdres: aliciAdresInput.value.trim(),
      not: faturaNotInput.value.trim(),
      items
    };

    btnCreateDraft.disabled = true;
    btnCreateDraft.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> GİB Portalında Oluşturuluyor...';

    try {
      const res = await fetch('/api/invoices/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Fatura taslağı başarıyla oluşturuldu! Belge No: ${data.belgeNumarasi || data.ettn}`, 'success');
        
        // Taslak faturayı önizlemede aç
        openInvoicePreview(data.ettn, 'Taslak');

        // Faturalar sekmesine geç ve yenile
        document.querySelector('[data-tab="tab-list"]').click();
      } else {
        showToast('Fatura oluşturma hatası: ' + (data.error || 'Bilinmeyen hata'), 'error');
      }
    } catch (err) {
      showToast('Ağ hatası: ' + err.message, 'error');
    } finally {
      btnCreateDraft.disabled = false;
      btnCreateDraft.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> GİB Portalında Taslak Oluştur';
    }
  });

  btnResetForm.addEventListener('click', () => {
    if (confirm('Fatura formundaki tüm alanlar temizlenecek. Onaylıyor musunuz?')) {
      invoiceForm.reset();
      itemsTableBody.innerHTML = '';
      createItemRow();
    }
  });

  // ==========================================
  // 6. Faturaları Listeleme & Filtreleme
  // ==========================================
  async function loadDashboardStats() {
    try {
      const res = await fetch('/api/dashboard/stats');
      const data = await res.json();
      if (data.success && data.data) {
        const s = data.data;
        if (kpiApprovedAmount) {
          kpiApprovedAmount.innerText = Number(s.totalApprovedAmount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' TL';
        }
        if (kpiApprovedCount) {
          kpiApprovedCount.innerText = `${s.approvedCount || 0} Onaylı Fatura`;
        }
        if (kpiApprovedKdv) {
          kpiApprovedKdv.innerText = Number(s.totalApprovedKdv || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' TL';
        }
        if (kpiApprovedMatrah) {
          kpiApprovedMatrah.innerText = `Matrah: ${Number(s.totalApprovedMatrah || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`;
        }
        if (kpiDraftCount) {
          kpiDraftCount.innerText = `${s.draftCount || 0} Adet`;
        }
        if (kpiLastSync && s.lastSyncTime) {
          const parts = s.lastSyncTime.split(' ');
          const timePart = parts[1] || s.lastSyncTime;
          kpiLastSync.innerText = `Son Sync: ${timePart}`;
        }
      }
    } catch (e) {
      console.warn('Dashboard istatistik hatası:', e);
    }
  }

  async function syncWithGib() {
    if (!btnSyncGib) return;
    btnSyncGib.disabled = true;
    btnSyncGib.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Senkronize Ediliyor...';

    const start = filterStartDate.value;
    const end = filterEndDate.value;

    try {
      const res = await fetch('/api/invoices/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: start, endDate: end })
      });
      const data = await res.json();

      if (data.success) {
        showToast(`GİB senkronizasyonu tamamlandı: ${data.sync.found} fatura kontrol edildi (${data.sync.added} yeni, ${data.sync.updated} güncellendi).`, 'success');
        await loadInvoices();
        await loadDashboardStats();
      } else {
        showToast('Senkronizasyon hatası: ' + (data.error || 'Bilinmeyen hata'), 'error');
      }
    } catch (err) {
      showToast('Ağ hatası: ' + err.message, 'error');
    } finally {
      btnSyncGib.disabled = false;
      btnSyncGib.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> GİB ile Senkronize Et';
    }
  }

  async function loadInvoices() {
    invoicesTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-4" style="text-align: center; color: var(--gray-500);">
          <i class="fa-solid fa-spinner fa-spin"></i> Faturalar yükleniyor...
        </td>
      </tr>
    `;

    const start = filterStartDate.value;
    const end = filterEndDate.value;
    const search = filterSearch ? filterSearch.value.trim() : '';
    const status = filterStatus ? filterStatus.value : '';

    const query = new URLSearchParams();
    if (start) query.append('startDate', start);
    if (end) query.append('endDate', end);
    if (search) query.append('search', search);
    if (status) query.append('status', status);

    try {
      const res = await fetch(`/api/invoices?${query.toString()}`);
      const data = await res.json();

      if (!data.success) {
        invoicesTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-4" style="text-align: center; color: var(--danger);">
              ${data.error || 'Faturalar alınamadı.'}
            </td>
          </tr>
        `;
        return;
      }

      const rawList = data.data || [];
      const list = rawList.filter(item => item && !item.error && (item.belgeNumarasi || item.ettn));
      invoicesCountBadge.innerText = list.length;

      if (list.length === 0) {
        invoicesTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-4" style="text-align: center; color: var(--gray-500);">
              Belirtilen kriterlere uygun fatura bulunamadı.
            </td>
          </tr>
        `;
        loadDashboardStats();
        return;
      }

      invoicesTableBody.innerHTML = '';
      list.forEach(inv => {
        const tr = document.createElement('tr');
        const status = (inv.onayDurumu || '').toLowerCase();
        const isApproved = status === 'onaylandı';
        const isDeleted = status === 'silinmiş';

        let statusBadge = '<span class="badge-status taslak"><i class="fa-solid fa-clock"></i> Taslak</span>';
        if (isApproved) {
          statusBadge = '<span class="badge-status onayli"><i class="fa-solid fa-check"></i> Onaylandı</span>';
        } else if (isDeleted) {
          statusBadge = '<span class="badge-status silinmis"><i class="fa-solid fa-ban"></i> Silinmiş</span>';
        } else if (inv.onayDurumu) {
          statusBadge = `<span class="badge-status taslak"><i class="fa-solid fa-clock"></i> ${inv.onayDurumu}</span>`;
        }

        const amountFormatted = inv.odenecekTutar 
          ? Number(inv.odenecekTutar).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' TL'
          : '-';

        let actionButtonsHtml = `
          <button class="btn btn-sm btn-outline btn-view-html" title="Faturayı Görüntüle">
            <i class="fa-solid fa-eye"></i>
          </button>
        `;

        if (isApproved) {
          actionButtonsHtml += `
            <button class="btn btn-sm btn-outline btn-download-zip" title="Resmi Arşivi İndir (ZIP)">
              <i class="fa-solid fa-download"></i> ZIP
            </button>
            <button class="btn btn-sm btn-outline btn-send-mail" title="Müşteriye E-Posta Gönder">
              <i class="fa-solid fa-envelope"></i>
            </button>
          `;
        } else if (!isDeleted) {
          actionButtonsHtml += `
            <button class="btn btn-sm btn-primary btn-sign-sms" title="SMS ile İmzala">
              <i class="fa-solid fa-signature"></i> İmzala
            </button>
            <button class="btn btn-sm btn-outline btn-del-draft" title="Taslağı Sil">
              <i class="fa-solid fa-trash"></i>
            </button>
          `;
        }

        tr.innerHTML = `
          <td>${inv.belgeTarihi || '-'}</td>
          <td><strong>${inv.belgeNumarasi || '-'}</strong></td>
          <td>${inv.aliciUnvanAdSoyad || '-'}</td>
          <td>${inv.aliciVknTckn || '-'}</td>
          <td><strong style="color: var(--primary);">${amountFormatted}</strong></td>
          <td>${statusBadge}</td>
          <td style="text-align: right">
            <div class="action-buttons">
              ${actionButtonsHtml}
            </div>
          </td>
        `;

        // Event listener'lar
        tr.querySelector('.btn-view-html').addEventListener('click', () => {
          openInvoicePreview(inv.ettn, inv.onayDurumu, inv.belgeNumarasi);
        });

        const signBtn = tr.querySelector('.btn-sign-sms');
        if (signBtn) {
          signBtn.addEventListener('click', () => {
            startSmsSigning(inv);
          });
        }

        const delBtn = tr.querySelector('.btn-del-draft');
        if (delBtn) {
          delBtn.addEventListener('click', () => {
            deleteDraftInvoice(inv);
          });
        }

        const dlBtn = tr.querySelector('.btn-download-zip');
        if (dlBtn) {
          dlBtn.addEventListener('click', () => {
            const token = getToken();
            const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
            window.open(`/api/invoices/${inv.ettn}/download?onayDurumu=Onaylandı${tokenParam}`, '_blank');
          });
        }

        const mailBtn = tr.querySelector('.btn-send-mail');
        if (mailBtn) {
          mailBtn.addEventListener('click', () => {
            currentEmailItem = inv;
            emailSubjectInput.value = `Resmi e-Arşiv Faturanız (${inv.belgeNumarasi || ''})`;
            openModal('modalSendEmail');
          });
        }

        invoicesTableBody.appendChild(tr);
      });

      loadDashboardStats();
    } catch (err) {
      invoicesTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-4" style="text-align: center; color: var(--danger);">
            Bağlantı hatası: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  btnFilterApply.addEventListener('click', loadInvoices);
  if (btnSyncGib) btnSyncGib.addEventListener('click', syncWithGib);
  if (filterStatus) filterStatus.addEventListener('change', loadInvoices);
  if (filterSearch) {
    filterSearch.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') loadInvoices();
    });
  }

  // ==========================================
  // 7. Fatura Önizleme Modalı
  // ==========================================
  function openInvoicePreview(ettn, onayDurumu = 'Taslak', belgeNumarasi = '') {
    const token = getToken();
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    previewIframe.src = `/api/invoices/${ettn}/html?onayDurumu=${encodeURIComponent(onayDurumu)}${tokenParam}&t=${Date.now()}`;
    document.getElementById('modalPreviewTitle').innerHTML = `
      <i class="fa-solid fa-file-invoice"></i> Resmi Fatura Önizleme - ${belgeNumarasi || ettn}
    `;
    openModal('modalPreview');
  }

  btnPrintInvoice.addEventListener('click', () => {
    if (previewIframe.contentWindow) {
      previewIframe.contentWindow.focus();
      previewIframe.contentWindow.print();
    }
  });

  // ==========================================
  // 8. SMS Onayı ve Resmi İmzalama
  // ==========================================
  async function startSmsSigning(inv) {
    currentSigningItem = inv;
    smsStep1.classList.remove('hidden');
    smsStep2.classList.add('hidden');
    smsInputCode.value = '';
    registeredPhoneNumber.innerText = 'GİB Kayıtlı Cep Telefonu Aranıyor...';

    openModal('modalSmsSign');

    // Kayıtlı telefonu getir
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      registeredPhoneNumber.innerText = 'GİB Portalındaki Kayıtlı Cep Telefonu';
    } catch (e) {
      registeredPhoneNumber.innerText = 'GİB Kayıtlı Telefon';
    }
  }

  btnTriggerSms.addEventListener('click', async () => {
    btnTriggerSms.disabled = true;
    btnTriggerSms.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> SMS Gönderiliyor...';

    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();

      if (data.success && data.oid) {
        activeSmsOid = data.oid;
        smsStep1.classList.add('hidden');
        smsStep2.classList.remove('hidden');
        smsInputCode.focus();
        showToast('SMS Onay Kodu cep telefonunuza iletildi.', 'info');
      } else {
        showToast(data.error || 'SMS gönderilemedi.', 'error');
      }
    } catch (err) {
      showToast('SMS Gönderim Hatası: ' + err.message, 'error');
    } finally {
      btnTriggerSms.disabled = false;
      btnTriggerSms.innerHTML = '<i class="fa-solid fa-paper-plane"></i> SMS Doğrulama Kodu Gönder';
    }
  });

  btnConfirmSign.addEventListener('click', async () => {
    const code = smsInputCode.value.trim();
    if (!code || code.length < 6) {
      showToast('Lütfen 6 haneli SMS kodunu giriniz.', 'error');
      return;
    }

    btnConfirmSign.disabled = true;
    btnConfirmSign.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fatura İmzalanıyor...';

    try {
      const res = await fetch('/api/sms/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smsCode: code,
          oid: activeSmsOid,
          ettn: currentSigningItem.ettn,
          belgeNumarasi: currentSigningItem.belgeNumarasi
        })
      });
      const data = await res.json();

      if (data.success) {
        showToast('Fatura Gelir İdaresi Başkanlığı tarafından başarıyla onaylandı ve mühürlendi!', 'success');
        closeModal('modalSmsSign');
        loadInvoices();
      } else {
        showToast(data.error || 'İmzalama başarısız oldu. SMS kodunu kontrol edin.', 'error');
      }
    } catch (err) {
      showToast('Hata: ' + err.message, 'error');
    } finally {
      btnConfirmSign.disabled = false;
      btnConfirmSign.innerHTML = '<i class="fa-solid fa-stamp"></i> Faturayı Onayla & İmzala';
    }
  });

  // ==========================================
  // 9. Taslak Silme
  // ==========================================
  async function deleteDraftInvoice(inv) {
    if (!confirm(`'${inv.belgeNumarasi || inv.ettn}' numaralı taslak faturayı silmek istediğinizden emin misiniz?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/invoices/${inv.ettn}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ettn: inv.ettn,
          belgeNumarasi: inv.belgeNumarasi,
          aliciVknTckn: inv.aliciVknTckn,
          aliciUnvanAdSoyad: inv.aliciUnvanAdSoyad,
          belgeTarihi: inv.belgeTarihi,
          belgeTuru: inv.belgeTuru || 'FATURA',
          onayDurumu: inv.onayDurumu || 'Onaylanmadı',
          silmeNedeni: 'Kullanıcı talebi'
        })
      });
      const data = await res.json();

      if (data.success) {
        showToast('Taslak fatura GİB portalından başarıyla silindi.', 'success');
        await loadInvoices();
        await loadDashboardStats();
      } else {
        showToast(data.error || 'Silme işlemi başarısız oldu.', 'error');
      }
    } catch (err) {
      showToast('Hata: ' + err.message, 'error');
    }
  }

  // ==========================================
  // 10. E-Posta Gönderimi
  // ==========================================
  sendEmailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEmailItem) return;

    const to = emailToInput.value.trim();
    const subject = emailSubjectInput.value.trim();
    const btnSubmit = document.getElementById('btnSubmitSendEmail');

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gönderiliyor...';

    try {
      const res = await fetch(`/api/invoices/${currentEmailItem.ettn}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          onayDurumu: currentEmailItem.onayDurumu,
          belgeNumarasi: currentEmailItem.belgeNumarasi
        })
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Fatura ${to} adresine başarıyla gönderildi.`, 'success');
        closeModal('modalSendEmail');
      } else {
        showToast(data.error || 'E-posta gönderilemedi.', 'error');
      }
    } catch (err) {
      showToast('E-posta Gönderim Hatası: ' + err.message, 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Gönder';
    }
  });

  // ==========================================
  // 11. Ayarlar Modalı
  // ==========================================
  btnOpenSettings.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();

      if (data.success) {
        const gib = data.gib || {};
        const mail = data.mail || {};

        document.getElementById('cfgKullaniciKodu').value = gib.kullaniciKodu || '';
        document.getElementById('cfgSifre').value = gib.sifre || '';
        document.getElementById('cfgVkn').value = gib.vkn || '';
        document.getElementById('cfgUnvan').value = gib.unvan || '';
        document.getElementById('cfgVergiDairesi').value = gib.vergiDairesi || '';

        document.getElementById('cfgSmtpHost').value = mail.host || '';
        document.getElementById('cfgSmtpPort').value = mail.port || '587';
        document.getElementById('cfgSmtpUser').value = mail.user || '';
        document.getElementById('cfgSmtpPass').value = mail.pass || '';
      }
      openModal('modalSettings');
    } catch (err) {
      showToast('Ayarlar yüklenemedi: ' + err.message, 'error');
    }
  });

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const gibConfig = {
      kullaniciKodu: document.getElementById('cfgKullaniciKodu').value.trim(),
      sifre: document.getElementById('cfgSifre').value,
      vkn: document.getElementById('cfgVkn').value.trim(),
      unvan: document.getElementById('cfgUnvan').value.trim(),
      vergiDairesi: document.getElementById('cfgVergiDairesi').value.trim()
    };

    const mailConfig = {
      host: document.getElementById('cfgSmtpHost').value.trim(),
      port: parseInt(document.getElementById('cfgSmtpPort').value, 10) || 587,
      user: document.getElementById('cfgSmtpUser').value.trim(),
      pass: document.getElementById('cfgSmtpPass').value
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gibConfig, mailConfig })
      });
      const data = await res.json();

      if (data.success) {
        showToast('Ayarlar başarıyla kaydedildi!', 'success');
        closeModal('modalSettings');
        checkGibStatus();
      } else {
        showToast(data.error || 'Ayarlar kaydedilemedi.', 'error');
      }
    } catch (err) {
      showToast('Hata: ' + err.message, 'error');
    }
  });

  // ==========================================
  // Yardımcı Fonksiyonlar
  // ==========================================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = '<i class="fa-solid fa-circle-info"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-circle-check"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';

    toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function convertNumberToTurkishWords(tutar) {
    const birler = ['', 'BİR', 'İKİ', 'ÜÇ', 'DÖRT', 'BEŞ', 'ALTI', 'YEDİ', 'SEKİZ', 'DOKUZ'];
    const onlar = ['', 'ON', 'YİRMİ', 'OTUZ', 'KIRK', 'ELLİ', 'ALTMIŞ', 'YETMİŞ', 'SEKSEN', 'DOKSAN'];
    const basamaklar = ['', 'BİN', 'MİLYON', 'MİLYAR'];

    function uclu(n) {
      let yuz = Math.floor(n / 100);
      let on = Math.floor((n % 100) / 10);
      let bir = n % 10;
      let res = '';
      if (yuz > 1) res += birler[yuz] + 'YÜZ';
      else if (yuz === 1) res += 'YÜZ';
      res += onlar[on] + birler[bir];
      return res;
    }

    const parts = Number(tutar).toFixed(2).split('.');
    let lira = parseInt(parts[0], 10);
    let kurus = parseInt(parts[1], 10);

    if (lira === 0 && kurus === 0) return 'SIFIR TÜRK LİRASI';

    let liraText = '';
    if (lira === 0) {
      liraText = 'SIFIR';
    } else {
      let idx = 0;
      while (lira > 0) {
        let g = lira % 1000;
        if (g > 0) {
          let gMetin = uclu(g);
          if (idx === 1 && g === 1) gMetin = '';
          liraText = gMetin + basamaklar[idx] + liraText;
        }
        lira = Math.floor(lira / 1000);
        idx++;
      }
    }

    let kurusText = '';
    if (kurus > 0) {
      let on = Math.floor(kurus / 10);
      let bir = kurus % 10;
      kurusText = ' ' + onlar[on] + birler[bir] + ' KURUŞ';
    }

    return 'YALNIZ ' + liraText + ' TÜRK LİRASI' + kurusText;
  }

  // ==========================================
  // 12. Excel ile Toplu Fatura Yükleme & Aktarım
  // ==========================================
  const bulkUploadDropzone = document.getElementById('bulkUploadDropzone');
  const bulkFileInput = document.getElementById('bulkFileInput');
  const btnSelectExcelFile = document.getElementById('btnSelectExcelFile');
  const selectedFileName = document.getElementById('selectedFileName');
  const bulkPreviewCard = document.getElementById('bulkPreviewCard');
  const bulkPreviewTableBody = document.getElementById('bulkPreviewTableBody');
  const bulkTotalRows = document.getElementById('bulkTotalRows');
  const bulkValidRows = document.getElementById('bulkValidRows');
  const bulkInvalidRows = document.getElementById('bulkInvalidRows');
  const bulkTotalAmount = document.getElementById('bulkTotalAmount');
  const bulkTotalKdv = document.getElementById('bulkTotalKdv');
  const btnCancelBulk = document.getElementById('btnCancelBulk');
  const btnExecuteBulkTransfer = document.getElementById('btnExecuteBulkTransfer');
  const btnExecuteBulkText = document.getElementById('btnExecuteBulkText');
  const bulkProgressArea = document.getElementById('bulkProgressArea');
  const bulkProgressTitle = document.getElementById('bulkProgressTitle');
  const bulkExecutionLog = document.getElementById('bulkExecutionLog');

  let currentParsedBulkData = null;

  if (btnSelectExcelFile && bulkFileInput) {
    btnSelectExcelFile.addEventListener('click', (e) => {
      e.stopPropagation();
      bulkFileInput.click();
    });
  }

  if (bulkUploadDropzone && bulkFileInput) {
    bulkUploadDropzone.addEventListener('click', () => {
      bulkFileInput.click();
    });

    bulkUploadDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      bulkUploadDropzone.classList.add('dragover');
    });

    bulkUploadDropzone.addEventListener('dragleave', () => {
      bulkUploadDropzone.classList.remove('dragover');
    });

    bulkUploadDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      bulkUploadDropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleExcelFileSelected(e.dataTransfer.files[0]);
      }
    });

    bulkFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleExcelFileSelected(e.target.files[0]);
      }
    });
  }

  async function handleExcelFileSelected(file) {
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      showToast('Lütfen sadece .xlsx veya .xls formatında bir Excel dosyası yükleyin.', 'error');
      return;
    }

    selectedFileName.innerText = `Seçilen Dosya: ${file.name} (${Math.round(file.size / 1024)} KB)`;
    showToast('Excel taranıyor ve satırlar doğrulanıyor...', 'info');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/bulk/preview', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!data.success) {
        showToast(data.error || 'Excel ayrıştırılamadı.', 'error');
        return;
      }

      currentParsedBulkData = data;
      renderBulkPreview(data);
    } catch (err) {
      showToast('Dosya yükleme hatası: ' + err.message, 'error');
    }
  }

  function renderBulkPreview(data) {
    bulkPreviewCard.classList.remove('hidden');
    bulkProgressArea.classList.add('hidden');
    bulkExecutionLog.innerHTML = '';

    const summary = data.summary || {};
    bulkTotalRows.innerText = summary.total || 0;
    bulkValidRows.innerText = summary.valid || 0;
    bulkInvalidRows.innerText = summary.invalid || 0;
    bulkTotalAmount.innerText = Number(summary.totalAmount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' TL';
    bulkTotalKdv.innerText = `KDV: ${Number(summary.totalKdv || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`;

    btnExecuteBulkText.innerText = `${summary.valid} Geçerli Faturayı GİB'e Aktar`;
    btnExecuteBulkTransfer.disabled = summary.valid === 0;

    bulkPreviewTableBody.innerHTML = '';
    (data.rows || []).forEach(row => {
      const tr = document.createElement('tr');
      const statusBadge = row.isValid
        ? '<span class="badge-status gecerli"><i class="fa-solid fa-check"></i> Geçerli</span>'
        : `<span class="badge-status gecersiz" title="${row.errors.join(', ')}"><i class="fa-solid fa-xmark"></i> Hatalı: ${row.errors[0]}</span>`;

      tr.innerHTML = `
        <td><strong>#${row.rowNumber}</strong></td>
        <td><code>${row.tcknVkn || '-'}</code></td>
        <td><strong>${row.alici || '-'}</strong></td>
        <td>${row.urunHizmet || '-'}</td>
        <td>${row.miktar} ${row.birim}</td>
        <td>${Number(row.matrah).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL</td>
        <td>%${row.kdvOrani} (${Number(row.kdv).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL)</td>
        <td><strong style="color: var(--primary);">${Number(row.genelToplam).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL</strong></td>
        <td>${statusBadge}</td>
      `;
      bulkPreviewTableBody.appendChild(tr);
    });

    // Önizleme kartına kaydır
    bulkPreviewCard.scrollIntoView({ behavior: 'smooth' });
  }

  if (btnCancelBulk) {
    btnCancelBulk.addEventListener('click', () => {
      bulkPreviewCard.classList.add('hidden');
      bulkFileInput.value = '';
      selectedFileName.innerText = '';
      currentParsedBulkData = null;
    });
  }

  if (btnExecuteBulkTransfer) {
    btnExecuteBulkTransfer.addEventListener('click', async () => {
      if (!currentParsedBulkData || !currentParsedBulkData.rows) return;

      const validRows = currentParsedBulkData.rows.filter(r => r.isValid);
      if (validRows.length === 0) {
        showToast('Aktarılacak geçerli fatura bulunmuyor.', 'error');
        return;
      }

      const totalFmt = Number(currentParsedBulkData.summary.totalAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
      if (!confirm(`Toplam ${validRows.length} adet fatura (Toplam: ₺${totalFmt}) Gelir İdaresi Başkanlığı e-Arşiv Portalına TASLAK olarak aktarılacak.\n\nOnaylıyor musunuz?`)) {
        return;
      }

      btnExecuteBulkTransfer.disabled = true;
      btnExecuteBulkTransfer.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> GİB Portalına Aktarılıyor...';
      bulkProgressArea.classList.remove('hidden');
      bulkExecutionLog.innerHTML = `<div style="color: var(--gray-500); padding: 4px;">Aktarım başlatıldı... (${validRows.length} kayıt)</div>`;

      try {
        const res = await fetch('/api/bulk/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: validRows })
        });
        const data = await res.json();

        if (data.success) {
          const results = data.results || [];
          bulkExecutionLog.innerHTML = '';
          results.forEach(r => {
            const div = document.createElement('div');
            div.style.padding = '4px 0';
            div.style.borderBottom = '1px solid #f1f5f9';
            if (r.success) {
              div.style.color = '#059669';
              div.innerHTML = `<strong>✔ Satır #${r.rowNumber}:</strong> ${r.alici} (${Number(r.tutar).toLocaleString('tr-TR')} TL) -> <strong>${r.belgeNumarasi || r.ettn}</strong> oluşturuldu.`;
            } else {
              div.style.color = '#dc2626';
              div.innerHTML = `<strong>✖ Satır #${r.rowNumber}:</strong> ${r.alici} -> Hata: ${r.error}`;
            }
            bulkExecutionLog.appendChild(div);
          });

          showToast(`Toplu aktarım tamamlandı: ${data.successCount} başarılı, ${data.failCount} başarısız.`, data.failCount > 0 ? 'info' : 'success');
          bulkProgressTitle.innerHTML = `<i class="fa-solid fa-check-circle" style="color: #059669;"></i> Aktarım Tamamlandı (${data.successCount} Başarılı, ${data.failCount} Başarısız)`;

          // Veritabanını ve sayaçları güncelle
          await loadInvoices();
          await loadDashboardStats();
        } else {
          showToast('Aktarım hatası: ' + (data.error || 'Bilinmeyen hata'), 'error');
        }
      } catch (err) {
        showToast('Bağlantı hatası: ' + err.message, 'error');
      } finally {
        btnExecuteBulkTransfer.disabled = false;
        btnExecuteBulkTransfer.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Tekrar Aktar';
      }
    });
  }

  // Başlangıç Ayarları
  function formatDateInput(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Tarih Filtresi: Ayın başından bugüne
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  filterStartDate.value = formatDateInput(firstDay);
  filterEndDate.value = formatDateInput(now);

  // İlk varsayılan satırı ekle
  createItemRow('Yazılım & SaaS Abonelik Hizmeti', 1, 'ADET', 1000, 20);

  // İlk oturum kontrolü ve durum yükleme
  checkInitialAuth().then(isLoggedIn => {
    checkGibStatus();
    if (isLoggedIn) {
      loadCompanies();
      loadDashboardStats();
      const u = getUser();
      if (u && u.role === 'admin') {
        loadUsers();
      }
    }
  });
});
