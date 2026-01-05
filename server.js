const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PUERTO = 3001; 

app.use(cors());
app.use(express.static(path.join(__dirname))); 

// --- BASE DE DATOS ---
const db = new sqlite3.Database('./historial.db');

db.run(`CREATE TABLE IF NOT EXISTS mediciones (
    fecha TEXT,
    hora TEXT,
    temp REAL,
    hum REAL,
    demanda_real REAL,
    demanda_prog REAL,
    PRIMARY KEY (fecha, hora)
)`);

const ID_EJECUTADA = 6;  
const ID_PROGRAMADA = 3; 

// --- HERRAMIENTAS ---
function obtenerFechaHoy() {
    const d = new Date();
    // Ajuste de zona horaria Perú (UTC-5) simple
    const peruTime = new Date(d.toLocaleString("en-US", {timeZone: "America/Lima"}));
    const yyyy = peruTime.getFullYear();
    const mm = String(peruTime.getMonth() + 1).padStart(2, '0');
    const dd = String(peruTime.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function keyHoraAFormatoVisual(hKey) {
    const numeroBloque = parseInt(hKey.replace('h', ''));
    const minutosTotales = (numeroBloque - 1) * 30;
    const horas = Math.floor(minutosTotales / 60);
    const mins = minutosTotales % 60;
    return `${horas.toString().padStart(2,'0')}:${mins.toString().padStart(2,'0')}`;
}

// --- LOGICA COES (Detecta futuro y pone NULL) ---
async function sincronizarCOES(fechaSolicitada) {
    console.log(`⚡ Procesando COES para: ${fechaSolicitada}`);
    const hoy = obtenerFechaHoy();
    const esHoy = (fechaSolicitada === hoy);
    
    // Calcular bloque actual (1 a 48)
    const ahora = new Date();
    const minutosDia = (ahora.getHours() * 60) + ahora.getMinutes();
    const bloqueActual = Math.floor(minutosDia / 30) + 1;

    const traerDatos = async (id) => {
        try {
            const url = `https://appserver.coes.org.pe/waMediciones/api/Mediciones?lectcodi=${id}&fechaIni=${fechaSolicitada}&fechaFin=${fechaSolicitada}`;
            const resp = await axios.get(url);
            return resp.data.listMediciones || resp.data || [];
        } catch (e) { return []; }
    };

    const [listaReal, listaProg] = await Promise.all([
        traerDatos(ID_EJECUTADA),
        traerDatos(ID_PROGRAMADA)
    ]);

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        for (let i = 1; i <= 48; i++) {
            const key = `h${i}`;
            const horaVisual = keyHoraAFormatoVisual(key);
            
            let sumaReal = 0;
            let sumaProg = 0;
            let hayDatoReal = false;

            if (Array.isArray(listaReal)) {
                listaReal.forEach(item => {
                    const val = parseFloat(item[key]);
                    if (!isNaN(val)) { sumaReal += val; hayDatoReal = true; }
                });
            }
            if (Array.isArray(listaProg)) {
                listaProg.forEach(item => sumaProg += parseFloat(item[key] || 0));
            }

            // MAGIA: Si es HOY y el bloque es futuro, forzamos NULL en la real
            let valorRealFinal = (hayDatoReal && sumaReal > 0) ? sumaReal : null;
            if (esHoy && i > bloqueActual) {
                valorRealFinal = null; 
            }

            // Guardar en DB si hay algo útil
            if (valorRealFinal !== null || sumaProg > 0) {
                const sql = `
                    INSERT INTO mediciones (fecha, hora, demanda_real, demanda_prog, temp, hum) 
                    VALUES (?, ?, ?, ?, NULL, NULL)
                    ON CONFLICT(fecha, hora) DO UPDATE SET
                    demanda_real = excluded.demanda_real,
                    demanda_prog = excluded.demanda_prog
                `;
                db.run(sql, [fechaSolicitada, horaVisual, valorRealFinal, sumaProg]);
            }
        }
        db.run("COMMIT");
    });
}

// --- LOGICA CLIMA (Historial 24h) ---
async function sincronizarClima(fechaSolicitada) {
    console.log(`🌤️ Procesando Clima para: ${fechaSolicitada}`);
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=-12.0464&longitude=-77.0428&hourly=temperature_2m,relative_humidity_2m&timezone=auto&start_date=${fechaSolicitada}&end_date=${fechaSolicitada}`;
        const resp = await axios.get(url);
        
        if(!resp.data.hourly) return;
        const hourly = resp.data.hourly;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            for (let i = 0; i < hourly.time.length; i++) {
                // Formato ISO: "2023-01-01T14:00"
                const horaPura = hourly.time[i].split('T')[1]; 
                const [hh, mm] = horaPura.split(':');
                
                const temp = hourly.temperature_2m[i];
                const hum = hourly.relative_humidity_2m[i];

                const sql = `
                    INSERT INTO mediciones (fecha, hora, temp, hum, demanda_real, demanda_prog) 
                    VALUES (?, ?, ?, ?, NULL, NULL)
                    ON CONFLICT(fecha, hora) DO UPDATE SET
                    temp = excluded.temp,
                    hum = excluded.hum
                `;
                
                // Guardamos para las XX:00 y las XX:30
                db.run(sql, [fechaSolicitada, `${hh}:00`, temp, hum]);
                db.run(sql, [fechaSolicitada, `${hh}:30`, temp, hum]);
            }
            db.run("COMMIT");
        });
    } catch (e) { console.error("Error Clima:", e.message); }
}

// --- RUTA API UNIFICADA ---
app.get('/api/datos', async (req, res) => {
    const fecha = req.query.fecha || obtenerFechaHoy();
    
    // Intentamos actualizar datos (si falla, leemos lo que haya en caché)
    try {
        await Promise.all([
            sincronizarCOES(fecha),
            sincronizarClima(fecha)
        ]);
    } catch (e) { console.log("Usando caché DB..."); }

    db.all(`SELECT * FROM mediciones WHERE fecha = ? ORDER BY hora ASC`, [fecha], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, fecha: fecha, datos: rows });
    });
});

app.listen(PUERTO, () => {
    console.log(`🚀 SERVIDOR OK: http://localhost:${PUERTO}`);
    console.log(`📅 Fecha servidor: ${obtenerFechaHoy()}`);
});