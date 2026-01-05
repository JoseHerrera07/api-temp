// --- CONFIGURACIÓN ---
let chartLinea;
const EJE_X_24H = [];
for (let h = 0; h < 24; h++) {
    let hh = h.toString().padStart(2, '0');
    EJE_X_24H.push(`${hh}:00`);
    EJE_X_24H.push(`${hh}:30`);
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Poner fecha de hoy en el calendario
    const inputFecha = document.getElementById('fecha-input');
    // Truco para obtener YYYY-MM-DD local correcto
    const hoy = new Date().toLocaleDateString('en-CA'); 
    if(inputFecha) {
        inputFecha.value = hoy;
        inputFecha.addEventListener('change', (e) => cargarDatos(e.target.value));
    }

    inicializarGrafico();
    cargarDatos(hoy); // Carga inicial

    // Refresco automático cada 5 min (solo si se ve el día de hoy)
    setInterval(() => {
        if (inputFecha.value === hoy) cargarDatos(hoy);
    }, 300000);
});

async function cargarDatos(fecha) {
    const status = document.getElementById('status');
    status.innerText = "⏳ Cargando...";
    
    try {
        const res = await fetch(`/api/datos?fecha=${fecha}`);
        const data = await res.json();

        if (data.ok) {
            actualizarGrafico(data.datos);
            actualizarTarjetas(data.datos);
            actualizarPicos(data.datos);
            actualizarTabla(data.datos);
            status.innerText = `✅ Actualizado (${data.fecha})`;
        }
    } catch (e) {
        console.error(e);
        status.innerText = "❌ Error servidor";
    }
}

function actualizarGrafico(datos) {
    // Arrays vacíos alineados al eje X
    const temp = new Array(48).fill(null);
    const hum = new Array(48).fill(null);
    const real = new Array(48).fill(null);
    const prog = new Array(48).fill(null);

    datos.forEach(d => {
        const idx = EJE_X_24H.indexOf(d.hora);
        if (idx !== -1) {
            temp[idx] = d.temp;
            hum[idx] = d.hum;
            real[idx] = d.demanda_real;
            prog[idx] = d.demanda_prog;
        }
    });

    chartLinea.data.datasets[0].data = temp;
    chartLinea.data.datasets[1].data = hum;
    chartLinea.data.datasets[2].data = real;
    chartLinea.data.datasets[3].data = prog;
    chartLinea.update();
}

function actualizarPicos(datos) {
    let picos = {
        temp: { val: -Infinity, hora:'-', icon:'thermostat', color:'icon-temp', border:'border-temp', label:'Temp Max' },
        hum:  { val: -Infinity, hora:'-', icon:'water_drop', color:'icon-hum',  border:'border-hum',  label:'Hum Max' },
        real: { val: -Infinity, hora:'-', icon:'bolt',       color:'icon-real', border:'border-real', label:'Demanda Max' },
        prog: { val: -Infinity, hora:'-', icon:'show_chart', iconStyle:'transform: rotate(90deg)', color:'icon-prog', border:'border-prog', label:'Prog Max' }
    };

    datos.forEach(d => {
        if(d.temp > picos.temp.val) { picos.temp.val = d.temp; picos.temp.hora = d.hora; }
        if(d.hum > picos.hum.val)   { picos.hum.val = d.hum;   picos.hum.hora = d.hora; }
        if(d.demanda_real > picos.real.val) { picos.real.val = d.demanda_real; picos.real.hora = d.hora; }
        if(d.demanda_prog > picos.prog.val) { picos.prog.val = d.demanda_prog; picos.prog.hora = d.hora; }
    });

    const container = document.getElementById('peaks-container');
    container.innerHTML = '';

    Object.values(picos).forEach(p => {
        const val = p.val > -Infinity ? p.val.toFixed(1) : '--';
        const style = p.iconStyle ? `style="${p.iconStyle}"` : '';
        container.innerHTML += `
            <div class="peak-item ${p.border}">
                <span class="material-icons-round peak-icon ${p.color}" ${style}>${p.icon}</span>
                <div class="peak-info">
                    <span class="peak-label">${p.label}</span>
                    <span class="peak-value">${val}</span>
                    <span class="peak-time">${p.hora} hrs</span>
                </div>
            </div>`;
    });
}

function actualizarTarjetas(datos) {
    if(datos.length === 0) return;
    // Último dato con demanda real (para no mostrar nulls)
    const ultimo = [...datos].reverse().find(d => d.demanda_real !== null) || datos[datos.length-1];

    document.getElementById('actual-temp').innerText = ultimo.temp ? `${ultimo.temp}°C` : '--';
    document.getElementById('actual-hum').innerText = ultimo.hum ? `${ultimo.hum}%` : '--';
    
    document.getElementById('coes-valor').innerText = ultimo.demanda_real ? `${ultimo.demanda_real.toFixed(0)} MW` : '--';
    document.getElementById('coes-hora').innerText = `Hora: ${ultimo.hora}`;
}

function actualizarTabla(datos) {
    const tbody = document.getElementById('tabla-datos-dia');
    tbody.innerHTML = '';
    // Mostramos últimos 15 registros relevantes
    const relevantes = [...datos].reverse().filter(d => d.temp || d.demanda_real).slice(0, 15);
    
    relevantes.forEach(d => {
        tbody.innerHTML += `
            <tr>
                <td><strong>${d.hora}</strong></td>
                <td>${d.temp || '--'}</td>
                <td>${d.hum || '--'}</td>
                <td style="color:#8e44ad; font-weight:bold;">${d.demanda_real ? d.demanda_real.toFixed(0) : '--'}</td>
                <td style="color:#e57373;">${d.demanda_prog ? d.demanda_prog.toFixed(0) : '--'}</td>
            </tr>`;
    });
}

function inicializarGrafico() {
    const ctx = document.getElementById('graficoClima').getContext('2d');
    chartLinea = new Chart(ctx, {
        type: 'line',
        data: {
            labels: EJE_X_24H,
            datasets: [
                { label: 'Temp (°C)', borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.1)', borderWidth: 2, tension: 0.4, yAxisID: 'y_temp', pointRadius:0, data:[] },
                { label: 'Humedad (%)', borderColor: '#3498db', borderDash:[5,5], borderWidth: 1, tension: 0.4, yAxisID: 'y_hum', pointRadius:0, data:[] },
                { label: 'Real (MW)', borderColor: '#8e44ad', backgroundColor: 'rgba(142, 68, 173, 0.1)', borderWidth: 2, fill: true, tension: 0.2, yAxisID: 'y_mw', pointRadius:0, data:[] },
                { label: 'Prog (MW)', borderColor: '#e57373', borderWidth: 2, tension: 0.2, yAxisID: 'y_mw', pointRadius:0, data:[] }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false } },
                y_temp: { type: 'linear', display: true, position: 'left', title: {display:true, text:'°C', color:'#f1c40f'}, grid:{display:false} },
                y_hum: { type: 'linear', display: true, position: 'right', min:0, max:100, grid:{display:false}, ticks:{color:'#3498db', display:false} },
                y_mw: { type: 'linear', display: true, position: 'right', title: {display:true, text:'MW', color:'#8e44ad'}, grid:{color:'#f0f0f0'} }
            }
        }
    });
}