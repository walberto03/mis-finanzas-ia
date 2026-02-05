import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, collection, onSnapshot, 
  query, orderBy, deleteDoc, doc, limit 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip
} from 'recharts';
import { 
  PieChart as PieIcon, MessageSquare, 
  Tag, TrendingUp, TrendingDown, Filter, X, Wallet, 
  Zap, CloudLightning, Calendar as CalendarIcon, Network, Trash2,
  ChevronRight, ChevronDown, Layers
} from 'lucide-react';

// --- CREDENCIALES REALES ---
const firebaseConfig = {
  apiKey: "AIzaSyD4oU6BxzgRuP8wj4aQAvUtcDpvMSR2mMQ",
  authDomain: "finanzas-familiares-7f59a.firebaseapp.com",
  projectId: "finanzas-familiares-7f59a",
  storageBucket: "finanzas-familiares-7f59a.firebasestorage.app",
  messagingSenderId: "24331042269",
  appId: "1:24331042269:web:54c6521656fd92abfb0a34",
  measurementId: "G-8X8KFTCKM0"
};

const appId = 'Finanzas_familia';

// --- INICIALIZACIÓN ---
let app;
if (getApps().length > 0) {
  app = getApp();
} else {
  app = initializeApp(firebaseConfig);
}

const auth = getAuth(app);
const db = getFirestore(app);

// Helper para fechas
const formatDateSafe = (createdAt) => {
  if (!createdAt || !createdAt.seconds) return '';
  try {
    return new Date(createdAt.seconds * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  } catch (e) { return ''; }
};

const formatCompactCurrency = (value) => {
  if (!value || isNaN(value)) return '$0';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${(value / 1000).toFixed(0)}k`; // Formato corto tipo 148k
};

// --- LÓGICA DE JERARQUÍA ---
// Esta función organiza los datos en Padre > Hijo automáticamente
const processHierarchy = (messages) => {
  const tagCounts = {};
  const tagValues = {};
  const hierarchy = {};

  // 1. Contar frecuencias globales para determinar quién es "Padre"
  messages.forEach(msg => {
    if (msg.type === 'income' || !msg.tags) return;
    msg.tags.forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
      tagValues[t] = (tagValues[t] || 0) + msg.amount;
    });
  });

  // 2. Agrupar transacciones
  messages.forEach(msg => {
    if (msg.type === 'income' || !msg.tags || msg.tags.length === 0) return;

    // El tag "Padre" es el más frecuente globalmente en este mensaje
    // Ej: En ["Gas", "Transporte"], Transporte es más común -> Padre
    const sortedTags = [...msg.tags].sort((a, b) => (tagCounts[b] || 0) - (tagCounts[a] || 0));
    const parentTag = sortedTags[0];
    
    if (!hierarchy[parentTag]) {
      hierarchy[parentTag] = { 
        name: parentTag, 
        value: 0, 
        count: 0,
        children: {} 
      };
    }

    hierarchy[parentTag].value += msg.amount;
    hierarchy[parentTag].count += 1;

    // Los demás tags son hijos
    sortedTags.slice(1).forEach(childTag => {
      if (!hierarchy[parentTag].children[childTag]) {
        hierarchy[parentTag].children[childTag] = { name: childTag, value: 0 };
      }
      hierarchy[parentTag].children[childTag].value += msg.amount;
    });
  });

  // Convertir a array y ordenar por valor
  return Object.values(hierarchy)
    .map(parent => ({
      ...parent,
      children: Object.values(parent.children).sort((a, b) => b.value - a.value)
    }))
    .sort((a, b) => b.value - a.value);
};

// --- COMPONENTE BUBBLE EXPLORER (HTML PURO - SIN SVG) ---
const BubbleExplorer = ({ data, onSelectCategory, selectedCategory }) => {
  if (!data || data.length === 0) return <div className="text-center text-slate-400 p-10">Sin datos</div>;

  // Si hay una categoría seleccionada, mostramos detalle
  if (selectedCategory) {
    const parent = data.find(d => d.name === selectedCategory);
    if (!parent) return null;

    return (
      <div className="h-[400px] bg-slate-900 rounded-3xl p-6 relative overflow-hidden flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/50 to-slate-900"></div>
        
        <button 
          onClick={() => onSelectCategory(null)}
          className="absolute top-4 left-4 z-20 bg-white/10 text-white px-3 py-1 rounded-full text-xs hover:bg-white/20 flex items-center gap-1"
        >
          <X size={14} /> Volver
        </button>

        {/* Burbuja Central (Padre) */}
        <div className="z-10 w-32 h-32 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex flex-col items-center justify-center shadow-lg shadow-indigo-500/30 mb-8 border-4 border-slate-800">
          <span className="text-white font-bold text-lg">{parent.name}</span>
          <span className="text-indigo-100 text-sm">{formatCompactCurrency(parent.value)}</span>
        </div>

        {/* Burbujas Hijos */}
        <div className="z-10 flex flex-wrap justify-center gap-3">
          {parent.children.length > 0 ? parent.children.map((child, idx) => (
            <div key={idx} className="px-4 py-2 rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 text-sm flex flex-col items-center min-w-[80px]">
              <span className="font-medium">{child.name}</span>
              <span className="text-xs text-slate-500">{formatCompactCurrency(child.value)}</span>
            </div>
          )) : (
            <span className="text-slate-500 text-sm">No hay subcategorías</span>
          )}
        </div>
      </div>
    );
  }

  // Vista Global (Top Categories)
  return (
    <div className="h-[400px] bg-slate-900 rounded-3xl p-4 relative overflow-hidden flex flex-wrap content-center justify-center gap-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800 to-black opacity-80"></div>
      
      {data.slice(0, 6).map((item, idx) => {
        // Escala visual basada en índice (el primero es más grande)
        const sizeClasses = idx === 0 ? "w-36 h-36 text-xl" : idx < 3 ? "w-28 h-28 text-base" : "w-20 h-20 text-xs";
        const gradient = idx === 0 ? "from-blue-500 to-indigo-600" : "from-slate-700 to-slate-600 hover:from-indigo-600 hover:to-purple-600";
        
        return (
          <button
            key={item.name}
            onClick={() => onSelectCategory(item.name)}
            className={`z-10 rounded-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center text-white shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 ${sizeClasses}`}
          >
            <span className="font-bold truncate max-w-[90%]">{item.name}</span>
            <span className="opacity-80 font-mono mt-1">{formatCompactCurrency(item.value)}</span>
          </button>
        );
      })}
      
      <div className="absolute bottom-4 w-full text-center text-[10px] text-slate-500 pointer-events-none">
        Toca para ver detalles
      </div>
    </div>
  );
};

export default function FinanceApp() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); 
  const messagesEndRef = useRef(null);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [isClient, setIsClient] = useState(false);
  const [selectedHierarchyNode, setSelectedHierarchyNode] = useState(null);

  // Estados expandidos para la lista (Accordion)
  const [expandedRows, setExpandedRows] = useState({});

  useEffect(() => {
    setIsClient(true);
    const initAuth = async () => {
        try { await signInAnonymously(auth); } catch (e) { console.error(e); }
    };
    initAuth();
    onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'consolidated_finances'),
      orderBy('createdAt', 'desc'), 
      limit(200)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      setMessages(msgs);
      if(activeTab === 'chat') setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [user, activeTab]);

  const handleDelete = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'consolidated_finances', id));
  };

  // --- FILTRADO ---
  const getFilteredMessages = () => {
    return messages.filter(msg => {
      if (!msg.createdAt) return false;
      const msgDate = new Date(msg.createdAt.seconds * 1000);
      if (dateFilter.start && msgDate < new Date(dateFilter.start)) return false;
      if (dateFilter.end) {
        const d = new Date(dateFilter.end); d.setHours(23,59,59);
        if (msgDate > d) return false;
      }
      return true;
    });
  };

  const currentMessages = getFilteredMessages();
  
  // Procesar datos para jerarquía
  const hierarchyData = useMemo(() => processHierarchy(currentMessages), [currentMessages]);

  const totalIncome = currentMessages.filter(m => m.type === 'income').reduce((acc, m) => acc + (m.amount || 0), 0);
  const totalExpense = currentMessages.filter(m => m.type !== 'income').reduce((acc, m) => acc + (m.amount || 0), 0);
  const balance = totalIncome - totalExpense;

  const toggleRow = (name) => {
    setExpandedRows(prev => ({ ...prev, [name]: !prev[name] }));
  };

  if (!isClient) return null;

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-800">
      
      {/* HEADER */}
      <header className="bg-white px-4 py-3 shadow-sm z-10 flex justify-between items-center border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-indigo-200 shadow-lg">
            <TrendingUp className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight text-slate-800">Finanzas Hogar</h1>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-600">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              En línea
            </div>
          </div>
        </div>
        <div className="bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
          <CloudLightning size={12} className="text-blue-500" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-slate-50/50">
        
        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <div className="p-4 pb-24 space-y-6">
            {messages.length === 0 && <div className="text-center py-10 opacity-50"><MessageSquare className="mx-auto mb-2"/>Esperando datos...</div>}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.sender === 'Yo' ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-end gap-2 max-w-[90%] ${msg.sender === 'Yo' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-bold shadow-sm ${msg.sender === 'Yo' ? 'bg-indigo-500' : 'bg-pink-500'}`}>
                    {msg.sender === 'Yo' ? 'Y' : 'E'}
                  </div>
                  <div className={`p-3 rounded-2xl shadow-sm border text-sm ${msg.sender === 'Yo' ? 'bg-white rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    <p className="mb-2 text-slate-600">"{msg.originalText}"</p>
                    <div className="bg-slate-50 rounded-xl p-2 border border-slate-100 min-w-[180px]">
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${msg.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}`}>
                          {msg.type === 'income' ? 'INGRESO' : 'GASTO'}
                        </span>
                        <span className="font-bold">${msg.amount?.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Array.isArray(msg.tags) && msg.tags.map((t, i) => (
                          <span key={i} className="text-[9px] bg-white border px-1 rounded text-slate-500">{t}</span>
                        ))}
                      </div>
                      <div className="text-[9px] text-right text-slate-300 mt-1">{formatDateSafe(msg.createdAt)}</div>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(msg.id)} className="text-slate-300 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* EXPLORE TAB (NUEVO HTML BUBBLES) */}
        {activeTab === 'explore' && (
          <div className="p-4 space-y-6 pb-24">
             <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4">
               <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Network className="text-indigo-600" /> Mapa de Gastos</h2>
               <p className="text-xs text-slate-500">Toca las burbujas para ver detalles.</p>
             </div>
             
             {/* Componente de Burbujas HTML */}
             <BubbleExplorer 
                data={hierarchyData} 
                selectedCategory={selectedHierarchyNode}
                onSelectCategory={setSelectedHierarchyNode}
             />
          </div>
        )}

        {/* STATS TAB (LISTA JERÁRQUICA) */}
        {activeTab === 'stats' && (
          <div className="p-4 space-y-6 pb-24">
            
            {/* Filtros */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex gap-2"><CalendarIcon size={14}/> Fechas</h3>
              <div className="flex gap-2">
                <input type="date" value={dateFilter.start} onChange={(e) => setDateFilter(prev => ({...prev, start: e.target.value}))} className="flex-1 bg-slate-50 border rounded-lg px-2 py-2 text-xs"/>
                <input type="date" value={dateFilter.end} onChange={(e) => setDateFilter(prev => ({...prev, end: e.target.value}))} className="flex-1 bg-slate-50 border rounded-lg px-2 py-2 text-xs"/>
                {(dateFilter.start || dateFilter.end) && <button onClick={() => setDateFilter({start:'', end:''})} className="p-2 bg-slate-100 rounded"><X size={14}/></button>}
              </div>
            </div>

            {/* Resumen */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-slate-100">
                <div className="text-green-600 text-xs font-bold mb-1 flex gap-1"><TrendingUp size={14}/> INGRESOS</div>
                <div className="text-xl font-bold">${totalIncome.toLocaleString()}</div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100">
                <div className="text-red-500 text-xs font-bold mb-1 flex gap-1"><TrendingDown size={14}/> EGRESOS</div>
                <div className="text-xl font-bold">${totalExpense.toLocaleString()}</div>
              </div>
            </div>

            {/* LISTA JERÁRQUICA (Con sangría) */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Filter size={18} /> Top Gastos</h3>
              <div className="space-y-1">
                {hierarchyData.length > 0 ? hierarchyData.map((item) => (
                  <div key={item.name} className="border-b border-slate-50 last:border-0">
                    {/* Fila Padre */}
                    <div 
                      className="flex justify-between items-center py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => toggleRow(item.name)}
                    >
                      <div className="flex items-center gap-2">
                        {item.children.length > 0 ? (
                          expandedRows[item.name] ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>
                        ) : <div className="w-4"/>}
                        
                        <div>
                          <span className="font-medium text-slate-700 text-sm block">{item.name}</span>
                          <div className="w-24 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                            <div className="h-full bg-indigo-500" style={{ width: `${Math.min((item.value / totalExpense) * 100, 100)}%` }}></div>
                          </div>
                        </div>
                      </div>
                      <span className="font-bold text-slate-800 text-sm">${item.value.toLocaleString()}</span>
                    </div>

                    {/* Fila Hijos (Sangría) */}
                    {expandedRows[item.name] && item.children.length > 0 && (
                      <div className="bg-slate-50/50 rounded-lg mb-2 overflow-hidden animate-in slide-in-from-top-2">
                        {item.children.map((child, cIdx) => (
                          <div key={cIdx} className="flex justify-between items-center py-2 px-3 pl-10 border-t border-white text-xs hover:bg-indigo-50/30">
                            <div className="flex items-center gap-2 text-slate-500">
                              <Layers size={12} className="opacity-50"/>
                              <span>{child.name}</span>
                            </div>
                            <span className="font-mono text-slate-600">${child.value.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )) : <div className="text-center text-slate-400 py-4 text-sm">No hay gastos registrados</div>}
              </div>
            </div>

          </div>
        )}
      </main>

      {/* NAV */}
      <nav className="bg-white border-t border-slate-100 flex justify-around p-1 z-30 pb-safe">
        <button onClick={() => setActiveTab('chat')} className={`p-3 rounded-xl transition-all ${activeTab === 'chat' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><MessageSquare size={24} /></button>
        <button onClick={() => setActiveTab('explore')} className={`p-3 rounded-xl transition-all ${activeTab === 'explore' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><Network size={24} /></button>
        <button onClick={() => setActiveTab('stats')} className={`p-3 rounded-xl transition-all ${activeTab === 'stats' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><PieIcon size={24} /></button>
      </nav>
    </div>
  );
}
