// --- CONFIGURACIÓN ---
const INTERVALO_TIEMPO = 300000; // 5 Minutos (Para actualizar y guardar seguido)

let chartLinea;
let chartGauge;

// Eje X Fijo (48 bloques de 00:00 a 23:30)
const EJE_X_24H = [];
for (let h = 0; h < 24; h++) {
    let horaStr = h.toString().padStart(2, '0');
    EJE_X_24H.push(`${horaStr}:00`);
    EJE_X_24H.push(`${horaStr}:30`);
}

document.addEventListener('DOMContentLoaded', () => {
    inicializarGraficos();
    
    // Primera carga
    sincronizarDatos();
    
    // Repetir ciclo
    setInterval(sincronizarDatos, INTERVALO_TIEMPO);
});

// ==========================================
//  LÓGICA PRINCIPAL
// ==========================================

async function sincronizarDatos() {
    const statusDiv = document.getElementById('status');
    statusDiv.innerText = "⏳ Sincronizando BD...";

    try {
        // Llamamos al servidor. El servidor obtendrá el dato actual, 
        // lo guardará en SQLite y nos devolverá TODO el historial del día.
        const res = await fetch('/api/sincronizar');
        const data = await res.json();

        if (data.ok) {
            renderizarGraficos(data.datos); // data.datos viene de la DB
            actualizarTarjetas(data.datos);
            statusDiv.innerText = `✅ Guardado en DB: ${new Date().toLocaleTimeString()}`;
        }

    } catch (e) {
        console.error("Error:", e);
        statusDiv.innerText = "❌ Error Conexión Servidor";
    }
}

// ==========================================
//  RENDERIZADO
// ==========================================

function renderizarGraficos(registrosDB) {
    // Preparamos arrays vacíos de 48 posiciones
    const dataTemp = new Array(48).fill(null);
    const dataReal = new Array(48).fill(null);
    const dataProg = new Array(48).fill(null);
    
    let maxTemp = -Infinity;
    let horaPico = "";

    // Llenamos los arrays con lo que vino de la Base de Datos
    registrosDB.forEach(reg => {
        // reg tiene: { hora: "14:30", temp: 22.5, demanda_real: 7000... }
        const index = EJE_X_24H.indexOf(reg.hora);
        if (index !== -1) {
            dataTemp[index] = reg.temp;
            dataReal[index] = reg.demanda_real;
            dataProg[index] = reg.demanda_prog;
        }

        if (reg.temp > maxTemp) {
            maxTemp = reg.temp;
            horaPico = reg.hora;
        }
    });

    // Actualizar Gráfico
    chartLinea.data.datasets[0].data = dataTemp;     // Temp
    chartLinea.data.datasets[2].data = dataReal;     // Real
    chartLinea.data.datasets[3].data = dataProg;     // Prog
    chartLinea.update();

    // Actualizar Gauge
    actualizarGaugeVisual(maxTemp, horaPico);

    // Actualizar Tabla
    const tbody = document.getElementById('tabla-datos-dia');
    tbody.innerHTML = '';
    // Mostrar en orden inverso (el más reciente arriba)
    [...registrosDB].reverse().forEach(d => {
        tbody.innerHTML += `
            <tr>
                <td>${d.hora}</td>
                <td><strong>${d.temp}°C</strong></td>
                <td>${d.hum}%</td>
            </tr>
        `;
    });
}

function actualizarTarjetas(registrosDB) {
    if (registrosDB.length === 0) return;

    // Tomamos el último registro guardado (el más reciente)
    const ultimo = registrosDB[registrosDB.length - 1];

    // Card Clima
    document.getElementById('actual-temp').innerText = `${ultimo.temp}°C`;
    document.getElementById('actual-hum').innerText = `${ultimo.hum}%`;
    document.getElementById('actual-hora').innerText = ultimo.hora;

    // Card COES
    const valorEl = document.getElementById('coes-valor');
    const horaEl = document.getElementById('coes-hora');
    
    if (ultimo.demanda_real > 0) {
        valorEl.innerText = `${ultimo.demanda_real.toFixed(0)} MW`;
        valorEl.style.color = "#8e44ad";
        
        const dif = ultimo.demanda_real - ultimo.demanda_prog;
        const color = dif > 0 ? '#e74c3c' : '#27ae60';
        const icono = dif > 0 ? '🔺' : '🔻';

        horaEl.innerHTML = `
            Hora: ${ultimo.hora}<br>
            <span style="font-size:0.8rem; color:#666">Prog: ${ultimo.demanda_prog.toFixed(0)}</span>
            <span style="font-size:0.8rem; color:${color}; margin-left:5px"><b>${icono} ${Math.abs(dif).toFixed(0)}</b></span>
        `;
    }
}

// (La configuración de Chart.js sigue igual, se llama en inicializarGraficos)
function inicializarGraficos() {
    const ctxLinea = document.getElementById('graficoClima').getContext('2d');
    chartLinea = new Chart(ctxLinea, {
        type: 'line',
        data: {
            labels: EJE_X_24H,
            datasets: [
                { label: 'Temp (°C)', data: [], borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.1)', borderWidth: 2, tension: 0.3, yAxisID: 'y' },
                { label: 'Humedad (%)', data: [], borderColor: '#3498db', borderWidth: 0, pointRadius:0, yAxisID: 'y1' },
                { label: 'Demanda Real (MW)', data: [], borderColor: '#8e44ad', backgroundColor: 'rgba(142, 68, 173, 0.05)', borderWidth: 2, fill: true, pointRadius: 2, tension: 0.1, yAxisID: 'y_mw' },
                { label: 'Programada (MW)', data: [], borderColor: '#95a5a6', borderDash: [5, 5], borderWidth: 1, pointRadius: 0, tension: 0.1, yAxisID: 'y_mw' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, stacked: false,
            scales: {
                y: { type: 'linear', display: true, position: 'left', min: 10, max: 35, title: {display:true, text:'Temp'} },
                y1: { display: false, min:0, max:100 },
                y_mw: { type: 'linear', display: true, position: 'right', min: 4000, suggestedMax: 8000, title: {display:true, text:'MW', color:'#8e44ad'}, grid: {drawOnChartArea: false} },
                x: { grid: { color: '#f8f9fa' } }
            }
        }
    });

    const ctxGauge = document.getElementById('graficoGauge').getContext('2d');
    chartGauge = new Chart(ctxGauge, {
        type: 'doughnut',
        data: {
            labels: ['Baja', 'Normal', 'Alta', 'Extrema'],
            datasets: [{ data: [25, 25, 25, 25], backgroundColor: ['#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'], borderWidth: 0, circumference: 180, rotation: 270 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
}

function actualizarGaugeVisual(temp, hora) {
    const valorEl = document.getElementById('gauge-valor');
    const horaEl = document.getElementById('gauge-hora');
    const aguja = document.getElementById('gauge-needle');
    if (temp === -Infinity || !temp) { valorEl.innerText = "--"; aguja.style.transform = `rotate(-90deg)`; return; }
    valorEl.innerText = `${temp}°C`; horaEl.innerText = `Pico: ${hora}`;
    const MIN = 15; const MAX = 30;
    let pct = (temp - MIN) / (MAX - MIN); if (pct < 0) pct = 0; if (pct > 1) pct = 1;
    aguja.style.transform = `rotate(${-90 + (180 * pct)}deg)`;
}