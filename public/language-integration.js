// Интеграция системы переводов в основной скрипт

// Функция переключения языка
function switchLanguage(lang) {
    if (translations[lang]) {
        currentLanguage = lang;
        localStorage.setItem('language', lang);
        
        // Обновляем активную кнопку
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-lang') === lang) {
                btn.classList.add('active');
            }
        });
        
        // Обновляем HTML атрибут языка
        document.documentElement.lang = lang === 'ru' ? 'ru' : 'en';
        
        // Обновляем все переводы на странице
        updatePageTranslations();
        
        // Перезагружаем динамический контент
        if (typeof updateOrdersList === 'function') {
            updateOrdersList();
        }
        
        if (typeof updateProfileStats === 'function') {
            updateProfileStats();
        }
        
        // Показываем уведомление о смене языка
        const langName = lang === 'ru' ? 'Русский' : 'English';
        showToast(
            t('success'),
            lang === 'ru' ? 'Язык изменён на Русский' : 'Language changed to English',
            'success'
        );
    }
}

// Инициализация языка при загрузке
document.addEventListener('DOMContentLoaded', function() {
    const savedLang = localStorage.getItem('language') || 'ru';
    currentLanguage = savedLang;
    
    // Устанавливаем активную кнопку языка
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-lang') === savedLang) {
            btn.classList.add('active');
        }
    });
    
    // Устанавливаем HTML атрибут языка
    document.documentElement.lang = savedLang === 'ru' ? 'ru' : 'en';
    
    // Применяем переводы
    updatePageTranslations();
});