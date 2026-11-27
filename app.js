/* =========================================================
   FRENCHLEX
   Advanced French Vocabulary — Offline First
   ========================================================= */

const DB_KEY = "frenchlex_database_v1";
const PROGRESS_KEY = "frenchlex_progress_v1";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const todayISO = () => {
    const d = new Date();
    d.setHours(0,0,0,0);
    return d.toISOString().slice(0,10);
};

const addDays = (dateString, days) => {
    const d = new Date(dateString + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
};

const escapeHTML = value => String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");

/* =========================================================
   STATE
   ========================================================= */

let INITIAL_WORDS = [];
let database = [];
let progress = {};
let currentCard = null;
let studyQueue = [];
let studyIndex = 0;
let editingId = null;

/* =========================================================
   STORAGE
   ========================================================= */

function saveDatabase(){
    localStorage.setItem(DB_KEY,JSON.stringify(database));
}

function saveProgress(){
    localStorage.setItem(PROGRESS_KEY,JSON.stringify(progress));
}

function loadData(){
    const savedDB = localStorage.getItem(DB_KEY);
    const savedProgress = localStorage.getItem(PROGRESS_KEY);

    if(savedDB){
        try{
            database = JSON.parse(savedDB);
        }catch{
            database = structuredClone(INITIAL_WORDS);
        }
    }else{
        database = structuredClone(INITIAL_WORDS);
        saveDatabase();
    }

    if(savedProgress){
        try{
            progress = JSON.parse(savedProgress);
        }catch{
            progress = {};
        }
    }

    if(!progress.sessions) progress.sessions = 0;
    if(!progress.history) progress.history = [];
    if(!progress.cards) progress.cards = {};

    database.forEach(card=>{
        if(!progress.cards[card.id]){
            progress.cards[card.id] = {
                reviews:0,
                due:todayISO(),
                lastReviewed:null,
                streak:0,
                mastered:false
            };
        }
    });

    saveProgress();
}

/* =========================================================
   TOAST
   ========================================================= */

let toastTimer;

function toast(message){
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>el.classList.remove("show"),2800);
}

/* =========================================================
   NAVIGATION
   ========================================================= */

function switchView(view){
    $$(".view").forEach(v=>v.classList.remove("active"));
    $(`#${view}`).classList.add("active");

    $$(".nav button").forEach(btn=>{
        btn.classList.toggle("active",btn.dataset.view===view);
    });

    $("#sidebar").classList.remove("open");

    if(view==="dashboard") renderDashboard();
    if(view==="study") startStudy();
    if(view==="library") renderLibrary();
}

$$(".nav button").forEach(btn=>{
    btn.addEventListener("click",()=>switchView(btn.dataset.view));
});

$("#menuBtn").addEventListener("click",()=>{
    $("#sidebar").classList.toggle("open");
});

$("#startStudyBtn").addEventListener("click",()=>switchView("study"));

/* =========================================================
   DASHBOARD
   ========================================================= */

function getDueCards(){
    const today = todayISO();

    return database.filter(card=>{
        const p = progress.cards[card.id];
        return !p || !p.due || p.due <= today;
    });
}

function renderDashboard(){
    const total = database.length;
    const due = getDueCards().length;

    const reviewed = database.filter(card=>{
        return progress.cards[card.id]?.reviews > 0;
    }).length;

    const mastered = database.filter(card=>{
        return progress.cards[card.id]?.mastered;
    }).length;

    const percent = total ? Math.round((mastered/total)*100) : 0;
    const reviewedPercent = total ? Math.round((reviewed/total)*100) : 0;

    $("#totalStat").textContent = total;
    $("#dueStat").textContent = due;
    $("#masteredStat").textContent = mastered;
    $("#sessionStat").textContent = progress.sessions || 0;
    $("#progressPercent").textContent = percent+"%";
    $("#globalProgress").style.width = percent+"%";
    $("#reviewedLabel").textContent = `${reviewed} / ${total}`;
    $("#reviewedProgress").style.width = reviewedPercent+"%";
    $("#todayDueText").textContent = due;

    const recent = (progress.history || []).slice(-7).reverse();

    if(!recent.length){
        $("#recentList").innerHTML = `
            <div class="empty" style="padding:25px 10px">
                <div class="empty-icon">📖</div>
                <div>لم تبدأ الدراسة بعد.</div>
            </div>`;
        return;
    }

    $("#recentList").innerHTML = recent.map(item=>{
        const card = database.find(c=>String(c.id)===String(item.id));
        if(!card) return "";
        return `
            <div class="recent-item">
                <span class="recent-word">${escapeHTML(card.word)}</span>
                <span class="recent-status">${escapeHTML(item.rating)} · ${escapeHTML(item.date)}</span>
            </div>`;
    }).join("");
}

/* =========================================================
   STUDY
   ========================================================= */

function startStudy(){
    studyQueue = getDueCards();

    if(!studyQueue.length){
        $("#studyCount").textContent = "لا توجد بطاقات مستحقة الآن";
        $("#studyArea").innerHTML = `
            <div class="card-panel empty">
                <div class="empty-icon">🎉</div>
                <h3 style="color:#e2e8f0">ممتاز! لا توجد مراجعات مستحقة.</h3>
                <p>يمكنك العودة لاحقاً بعد حلول مواعيد البطاقات القادمة.</p>
            </div>`;
        return;
    }

    studyIndex = 0;
    renderStudyCard();
}

function renderStudyCard(){
    if(studyIndex >= studyQueue.length){
        $("#studyCount").textContent = "اكتملت الجلسة";
        $("#studyArea").innerHTML = `
            <div class="card-panel empty">
                <div class="empty-icon">🏆</div>
                <h3 style="color:#e2e8f0">انتهت جلسة المراجعة!</h3>
                <p>لقد راجعت جميع البطاقات المستحقة في هذه الجلسة.</p>
                <button class="btn btn-primary" id="backToDashboardBtn">العودة للوحة التحكم</button>
            </div>`;
        return;
    }

    currentCard = studyQueue[studyIndex];

    $("#studyCount").textContent =
        `${studyIndex+1} / ${studyQueue.length} بطاقة`;

    $("#studyArea").innerHTML = `
        <div class="flashcard" id="activeFlashcard" title="انقر مرتين بالزر الأيسر لقلب البطاقة">
            <div class="card-inner">

                <div class="card-face">

                    <div class="card-glow"></div>

                    <button class="tts-btn" id="ttsBtn" title="نطق الكلمة">
                        🔊
                    </button>

                    <span class="pos-badge">${escapeHTML(currentCard.pos)}</span>

                    <div class="word">${escapeHTML(currentCard.word)}</div>

                    <div class="flip-info">
                        انقر مرتين بالزر الأيسر للفأرة لرؤية الإجابة
                    </div>

                </div>

                <div class="card-face card-back">

                    <div style="width:100%;margin-bottom:15px">
                        <span class="pos-badge">${escapeHTML(currentCard.pos)}</span>
                        <div style="font-size:27px;font-weight:800;margin-top:8px;direction:ltr;text-align:center">
                            ${escapeHTML(currentCard.word)}
                        </div>
                    </div>

                    <div class="meaning-grid">

                        <div class="meaning">
                            <span>المعنى الأول</span>
                            <strong>${escapeHTML(currentCard.meaning1)}</strong>
                        </div>

                        <div class="meaning">
                            <span>المعنى الثاني</span>
                            <strong>${escapeHTML(currentCard.meaning2)}</strong>
                        </div>

                    </div>

                    <div class="example">
                        <div class="example-label">EXEMPLE FRANÇAIS</div>
                        <div class="fr">${escapeHTML(currentCard.example)}</div>
                        <div class="ar">${escapeHTML(currentCard.translation)}</div>
                    </div>

                </div>
            </div>
        </div>

        <div class="study-hint">
            Double Click لقلب البطاقة · Space للقلب · H / G / E للتقييم
        </div>

        <div class="rating" id="ratingArea">

            <button class="rate rate-hard" data-rating="hard">
                صعب
                <small>المراجعة غداً</small>
            </button>

            <button class="rate rate-good" data-rating="good">
                جيد
                <small>المراجعة بعد 3 أيام</small>
            </button>

            <button class="rate rate-easy" data-rating="easy">
                سهل جداً
                <small>المراجعة بعد 5 أيام</small>
            </button>

        </div>
    `;

    const activeCard = $("#activeFlashcard");

    activeCard.addEventListener("dblclick",event=>{
        if(event.button === 0){
            event.preventDefault();
            flipCard();
        }
    });

    $("#ttsBtn").addEventListener("click",event=>{
        event.stopPropagation();
        speakFrench(currentCard.word);
    });

    $$(".rate").forEach(btn=>{
        btn.addEventListener("click",()=>{
            rateCurrentCard(btn.dataset.rating);
        });
    });
}

function flipCard(){
    const card = $("#activeFlashcard");
    if(!card) return;

    card.classList.add("flipped");

    setTimeout(()=>{
        const rating = $("#ratingArea");
        if(rating) rating.classList.add("show");
    },380);
}

function speakFrench(text){
    if(!("speechSynthesis" in window)){
        toast("متصفحك لا يدعم النطق الصوتي.");
        return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = .82;
    utterance.pitch = 1;

    const voices = speechSynthesis.getVoices();
    const frenchVoice = voices.find(v=>v.lang.toLowerCase().startsWith("fr"));

    if(frenchVoice) utterance.voice = frenchVoice;

    window.speechSynthesis.speak(utterance);
}

function rateCurrentCard(rating){
    if(!currentCard) return;

    const days = {
        hard:1,
        good:3,
        easy:5
    }[rating];

    const p = progress.cards[currentCard.id] || {
        reviews:0,
        due:todayISO(),
        lastReviewed:null,
        streak:0,
        mastered:false
    };

    p.reviews++;
    p.lastReviewed = todayISO();
    p.due = addDays(todayISO(),days);

    if(rating==="hard"){
        p.streak = 0;
        p.mastered = false;
    }

    if(rating==="good"){
        p.streak++;
        if(p.reviews >= 3) p.mastered = true;
    }

    if(rating==="easy"){
        p.streak++;
        if(p.reviews >= 2) p.mastered = true;
    }

    progress.cards[currentCard.id] = p;

    progress.history.push({
        id:currentCard.id,
        rating:
            rating==="hard" ? "صعب" :
            rating==="good" ? "جيد" : "سهل جداً",
        date:todayISO()
    });

    if(progress.history.length > 100){
        progress.history = progress.history.slice(-100);
    }

    saveProgress();

    const area = $("#activeFlashcard");

    if(area){
        area.style.opacity = "0";
        area.style.transform = "translateX(-40px) scale(.97)";
        area.style.transition = ".28s";
    }

    setTimeout(()=>{
        studyIndex++;
        renderStudyCard();
        renderDashboard();
    },300);
}

$("#shuffleBtn").addEventListener("click",()=>{
    for(let i=studyQueue.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [studyQueue[i],studyQueue[j]]=[studyQueue[j],studyQueue[i]];
    }
    studyIndex=0;
    renderStudyCard();
});

/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */

document.addEventListener("keydown",event=>{
    const studyView = $("#study").classList.contains("active");
    if(!studyView) return;

    if(event.code==="Space"){
        event.preventDefault();

        const card = $("#activeFlashcard");
        if(card && !card.classList.contains("flipped")){
            flipCard();
        }
    }

    if(event.key.toLowerCase()==="h"){
        const rating = $("#ratingArea");
        if(rating?.classList.contains("show")) rateCurrentCard("hard");
    }

    if(event.key.toLowerCase()==="g"){
        const rating = $("#ratingArea");
        if(rating?.classList.contains("show")) rateCurrentCard("good");
    }

    if(event.key.toLowerCase()==="e"){
        const rating = $("#ratingArea");
        if(rating?.classList.contains("show")) rateCurrentCard("easy");
    }
});

/* =========================================================
   LIBRARY
   ========================================================= */

function renderLibrary(){
    const query = ($("#searchInput")?.value || "").trim().toLowerCase();
    const pos = $("#posFilter")?.value || "";

    const filtered = database.filter(card=>{
        const matchesQuery =
            !query ||
            card.word.toLowerCase().includes(query) ||
            card.meaning1.toLowerCase().includes(query) ||
            card.meaning2.toLowerCase().includes(query) ||
            card.example.toLowerCase().includes(query);

        const matchesPos = !pos || card.pos===pos;

        return matchesQuery && matchesPos;
    });

    if(!filtered.length){
        $("#libraryBody").innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty" style="padding:40px">
                        <div class="empty-icon">🔎</div>
                        لا توجد نتائج.
                    </div>
                </td>
            </tr>`;
        return;
    }

    $("#libraryBody").innerHTML = filtered.map((card,index)=>{
        const p = progress.cards[card.id] || {};
        const due = p.due || todayISO();

        return `
            <tr>
                <td>${index+1}</td>
                <td class="word-cell">${escapeHTML(card.word)}</td>
                <td>${escapeHTML(card.pos)}</td>
                <td>${escapeHTML(card.meaning1)}</td>
                <td>${escapeHTML(card.meaning2)}</td>
                <td>
                    <span style="font-size:11px;color:${due<=todayISO()?'#fca5a5':'#86efac'}">
                        ${due<=todayISO()?'مستحقة':due}
                    </span>
                </td>
                <td>
                    <div class="actions">
                        <button class="icon-btn edit-btn" data-id="${card.id}" title="تعديل">✏</button>
                        <button class="icon-btn delete-btn" data-id="${card.id}" title="حذف">🗑</button>
                    </div>
                </td>
            </tr>`;
    }).join("");

    $$(".edit-btn").forEach(btn=>{
        btn.addEventListener("click",()=>openEditModal(Number(btn.dataset.id)));
    });

    $$(".delete-btn").forEach(btn=>{
        btn.addEventListener("click",()=>deleteCard(Number(btn.dataset.id)));
    });
}

$("#searchInput").addEventListener("input",renderLibrary);
$("#posFilter").addEventListener("change",renderLibrary);

/* =========================================================
   CRUD MODAL
   ========================================================= */

function openAddModal(){
    editingId = null;
    $("#modalTitle").textContent = "إضافة بطاقة جديدة";
    $("#cardForm").reset();
    $("#fPos").value = "Nom";
    $("#cardModal").classList.add("open");
}

function openEditModal(id){
    const card = database.find(c=>c.id===id);
    if(!card) return;

    editingId = id;

    $("#modalTitle").textContent = "تعديل البطاقة";

    $("#fWord").value = card.word;
    $("#fPos").value = card.pos;
    $("#fMeaning1").value = card.meaning1;
    $("#fMeaning2").value = card.meaning2;
    $("#fExample").value = card.example;
    $("#fTranslation").value = card.translation;

    $("#cardModal").classList.add("open");
}

function closeModal(){
    $("#cardModal").classList.remove("open");
    editingId = null;
}

$("#addBtn").addEventListener("click",openAddModal);
$("#closeModal").addEventListener("click",closeModal);
$("#cancelModal").addEventListener("click",closeModal);

$("#cardModal").addEventListener("click",event=>{
    if(event.target===event.currentTarget) closeModal();
});

$("#cardForm").addEventListener("submit",event=>{
    event.preventDefault();

    const data = {
        word:$("#fWord").value.trim(),
        pos:$("#fPos").value,
        meaning1:$("#fMeaning1").value.trim(),
        meaning2:$("#fMeaning2").value.trim(),
        example:$("#fExample").value.trim(),
        translation:$("#fTranslation").value.trim()
    };

    if(editingId!==null){
        const index = database.findIndex(c=>c.id===editingId);

        if(index!==-1){
            database[index] = {
                ...database[index],
                ...data
            };
        }

        toast("تم تعديل البطاقة بنجاح.");
    }else{
        const newId = database.length
            ? Math.max(...database.map(c=>Number(c.id))) + 1
            : 1;

        database.push({
            id:newId,
            ...data
        });

        progress.cards[newId] = {
            reviews:0,
            due:todayISO(),
            lastReviewed:null,
            streak:0,
            mastered:false
        };

        toast("تمت إضافة البطاقة بنجاح.");
    }

    saveDatabase();
    saveProgress();
    closeModal();
    renderLibrary();
    renderDashboard();
});

function deleteCard(id){
    const card = database.find(c=>c.id===id);
    if(!card) return;

    const ok = confirm(`هل تريد حذف البطاقة "${card.word}" نهائياً؟`);
    if(!ok) return;

    database = database.filter(c=>c.id!==id);

    delete progress.cards[id];

    saveDatabase();
    saveProgress();

    renderLibrary();
    renderDashboard();

    toast("تم حذف البطاقة.");
}

/* =========================================================
   EXPORT / IMPORT
   ========================================================= */

$("#exportBtn").addEventListener("click",()=>{
    const payload = {
        app:"FrenchLex",
        version:1,
        exportedAt:new Date().toISOString(),
        database,
        progress
    };

    const blob = new Blob(
        [JSON.stringify(payload,null,2)],
        {type:"application/json"}
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `frenchlex-backup-${todayISO()}.json`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);

    toast("تم تصدير النسخة الاحتياطية.");
});

$("#importBtn").addEventListener("click",()=>{
    $("#importFile").click();
});

$("#importFile").addEventListener("change",async event=>{
    const file = event.target.files[0];
    if(!file) return;

    try{
        const text = await file.text();
        const data = JSON.parse(text);

        if(!Array.isArray(data.database)){
            throw new Error("Invalid database");
        }

        database = data.database;

        if(data.progress){
            progress = data.progress;
        }

        database.forEach(card=>{
            if(!progress.cards[card.id]){
                progress.cards[card.id] = {
                    reviews:0,
                    due:todayISO(),
                    lastReviewed:null,
                    streak:0,
                    mastered:false
                };
            }
        });

        saveDatabase();
        saveProgress();

        renderDashboard();
        renderLibrary();

        toast("تم استيراد البيانات بنجاح.");
    }catch(error){
        console.error(error);
        toast("ملف النسخة الاحتياطية غير صالح.");
    }

    event.target.value="";
});

/* =========================================================
   RESET / RESTORE
   ========================================================= */

$("#restoreBtn").addEventListener("click",()=>{
    const ok = confirm(
        "سيتم استبدال قاعدة البطاقات الحالية بالـ200 بطاقة الأصلية. هل تريد المتابعة؟"
    );

    if(!ok) return;

    database = structuredClone(INITIAL_WORDS);

    database.forEach(card=>{
        if(!progress.cards[card.id]){
            progress.cards[card.id] = {
                reviews:0,
                due:todayISO(),
                lastReviewed:null,
                streak:0,
                mastered:false
            };
        }
    });

    saveDatabase();
    saveProgress();

    renderDashboard();
    renderLibrary();

    toast("تمت استعادة البطاقات الأصلية.");
});

$("#resetProgressBtn").addEventListener("click",()=>{
    const ok = confirm(
        "هل تريد حذف جميع بيانات التقدم وجدولة المراجعة؟"
    );

    if(!ok) return;

    progress = {
        sessions:0,
        history:[],
        cards:{}
    };

    database.forEach(card=>{
        progress.cards[card.id] = {
            reviews:0,
            due:todayISO(),
            lastReviewed:null,
            streak:0,
            mastered:false
        };
    });

    saveProgress();

    renderDashboard();
    toast("تمت إعادة تعيين التقدم.");
});

$("#factoryBtn").addEventListener("click",()=>{
    const ok = confirm(
        "تحذير: سيتم حذف البطاقات المضافة والتعديلات والتقدم وإعادة التطبيق إلى حالته الأصلية. هل أنت متأكد؟"
    );

    if(!ok) return;

    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(PROGRESS_KEY);

    location.reload();
});

/* =========================================================
   SESSION
   ========================================================= */

function registerSession(){
    const today = todayISO();
    const lastSession = localStorage.getItem("frenchlex_last_session");

    if(lastSession !== today){
        progress.sessions = (progress.sessions || 0) + 1;
        localStorage.setItem("frenchlex_last_session",today);
        saveProgress();
    }
}

/* =========================================================
   INIT
   ========================================================= */

async function init(){
    try{
        const res = await fetch('./data.json');
        INITIAL_WORDS = await res.json();
    }catch(err){
        console.error("فشل تحميل data.json، سيتم الاعتماد على localStorage فقط.",err);
        INITIAL_WORDS = [];
    }

    loadData();
    registerSession();
    renderDashboard();
    renderLibrary();
}

/* تحديث تلقائي بسيط عند العودة للتطبيق */
document.addEventListener("visibilitychange",()=>{
    if(!document.hidden){
        loadData();
        renderDashboard();

        if($("#library").classList.contains("active")){
            renderLibrary();
        }
    }
});

/* دعم أصوات المتصفح التي يتم تحميلها بشكل غير متزامن */
if("speechSynthesis" in window){
    window.speechSynthesis.onvoiceschanged = ()=>{};
}

/* بدء التشغيل */
init();