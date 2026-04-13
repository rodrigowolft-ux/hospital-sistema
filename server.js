const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
const baseDatos = new sqlite3.Database('./hospital.db');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'hospital_secreto',
    resave: false,
    saveUninitialized: false
}));
app.use(express.static('public'));

/*
CREAR TABLAS SI NO EXISTEN
*/

/* Tabla principal de usuarios del sistema */
baseDatos.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombreUsuario TEXT UNIQUE,
    contrasena TEXT,
    rol TEXT
)`);

/* Datos médicos del paciente, enlazados a su usuario */
baseDatos.run(`CREATE TABLE IF NOT EXISTS datos_paciente (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_usuario INTEGER UNIQUE,
    nombre TEXT,
    edad INTEGER,
    diagnostico TEXT,
    doctor_asignado TEXT,
    cita_medica TEXT,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
)`);

/* Datos del doctor, enlazados a su usuario */
baseDatos.run(`CREATE TABLE IF NOT EXISTS datos_doctor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_usuario INTEGER UNIQUE,
    nombre TEXT,
    especialidad TEXT,
    telefono TEXT,
    horario TEXT,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
)`);

/* Solicitudes de cita enviadas por pacientes */
baseDatos.run(`CREATE TABLE IF NOT EXISTS solicitudes_cita (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_usuario INTEGER,
    nombre_paciente TEXT,
    doctor_solicitado TEXT,
    fecha_solicitada TEXT,
    motivo TEXT,
    estado TEXT DEFAULT 'pendiente',
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
)`);

/* Crear administrador por defecto si no existe */
baseDatos.get("SELECT * FROM usuarios WHERE nombreUsuario='admin'", (err, fila) => {
    if (!fila) {
        baseDatos.run("INSERT INTO usuarios (nombreUsuario, contrasena, rol) VALUES ('admin', '1234', 'admin')");
    }
});

/*
MIDDLEWARES DE AUTENTICACIÓN
*/
function requireAuth(req, res, next) {
    if (!req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.usuario || req.session.usuario.rol !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
}

function requireDoctor(req, res, next) {
    if (!req.session.usuario || req.session.usuario.rol !== 'doctor') {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
}

/*
RUTAS PRINCIPALES
*/

/* Página de inicio — muestra el login */
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

/* Ruta de inicio de sesión */
app.post('/login', (req, res) => {
    const { nombreUsuario, contrasena } = req.body;
    baseDatos.get(
        "SELECT * FROM usuarios WHERE nombreUsuario=? AND contrasena=?",
        [nombreUsuario, contrasena],
        (err, fila) => {
            if (fila) {
                req.session.usuario = {
                    id: fila.id,
                    nombreUsuario: fila.nombreUsuario,
                    rol: fila.rol
                };
                if (fila.rol === 'admin') {
                    res.json({ redirigir: '/admin.html' });
                } else if (fila.rol === 'doctor') {
                    res.json({ redirigir: '/doctor.html' });
                } else if (fila.rol === 'paciente') {
                    res.json({ redirigir: '/user.html' });
                } else {
                    res.status(403).json({ error: 'Rol no reconocido' });
                }
            } else {
                res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
            }
        }
    );
});

/* Devuelve los datos de la sesión activa */
app.get('/sesion', (req, res) => {
    if (req.session.usuario) {
        res.json(req.session.usuario);
    } else {
        res.status(401).json({ error: 'No autenticado' });
    }
});

/* Cierra la sesión del usuario */
app.post('/cerrar-sesion', (req, res) => {
    req.session.destroy();
    res.json({ ok: true });
});

/*
RUTAS ADMIN — CREAR DOCTOR
*/
app.post('/admin/crear-doctor', requireAdmin, (req, res) => {
    const { nombreUsuario, contrasena, nombre, especialidad, telefono, horario } = req.body;

    baseDatos.run(
        "INSERT INTO usuarios (nombreUsuario, contrasena, rol) VALUES (?, ?, 'doctor')",
        [nombreUsuario, contrasena],
        function(err) {
            if (err) return res.status(500).json({ error: 'El usuario ya existe o hubo un error' });
            const idNuevo = this.lastID;

            baseDatos.run(
                "INSERT INTO datos_doctor (id_usuario, nombre, especialidad, telefono, horario) VALUES (?, ?, ?, ?, ?)",
                [idNuevo, nombre, especialidad, telefono, horario],
                (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ mensaje: 'Doctor creado correctamente' });
                }
            );
        }
    );
});

/*
RUTAS ADMIN — CREAR PACIENTE
*/
app.post('/admin/crear-paciente', requireAdmin, (req, res) => {
    const { nombreUsuario, contrasena, nombre, edad, diagnostico, doctor_asignado, cita_medica } = req.body;

    baseDatos.run(
        "INSERT INTO usuarios (nombreUsuario, contrasena, rol) VALUES (?, ?, 'paciente')",
        [nombreUsuario, contrasena],
        function(err) {
            if (err) return res.status(500).json({ error: 'El usuario ya existe o hubo un error' });
            const idNuevo = this.lastID;

            baseDatos.run(
                "INSERT INTO datos_paciente (id_usuario, nombre, edad, diagnostico, doctor_asignado, cita_medica) VALUES (?, ?, ?, ?, ?, ?)",
                [idNuevo, nombre, edad, diagnostico, doctor_asignado, cita_medica],
                (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ mensaje: 'Paciente creado correctamente' });
                }
            );
        }
    );
});

/*
RUTAS ADMIN — BORRAR DOCTOR
*/
app.delete('/admin/borrar-doctor/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    baseDatos.run("DELETE FROM datos_doctor WHERE id_usuario=?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        baseDatos.run("DELETE FROM usuarios WHERE id=?", [id], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ mensaje: 'Doctor eliminado correctamente' });
        });
    });
});

/*
RUTAS ADMIN — BORRAR PACIENTE
*/
app.delete('/admin/borrar-paciente/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    baseDatos.run("DELETE FROM datos_paciente WHERE id_usuario=?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        baseDatos.run("DELETE FROM usuarios WHERE id=?", [id], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ mensaje: 'Paciente eliminado correctamente' });
        });
    });
});

/*
RUTAS ADMIN — LISTAS
*/
app.get('/admin/lista-doctores', requireAdmin, (req, res) => {
    baseDatos.all(`
        SELECT u.id, u.nombreUsuario, dd.nombre, dd.especialidad, dd.telefono, dd.horario
        FROM usuarios u
        JOIN datos_doctor dd ON u.id = dd.id_usuario
    `, [], (err, filas) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(filas);
    });
});

app.get('/admin/lista-pacientes', requireAdmin, (req, res) => {
    baseDatos.all(`
        SELECT u.id, u.nombreUsuario, dp.nombre, dp.edad, dp.diagnostico, dp.doctor_asignado, dp.cita_medica
        FROM usuarios u
        JOIN datos_paciente dp ON u.id = dp.id_usuario
    `, [], (err, filas) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(filas);
    });
});

/* Lista de solicitudes de cita — visible para el admin */
app.get('/admin/solicitudes', requireAdmin, (req, res) => {
    baseDatos.all("SELECT * FROM solicitudes_cita ORDER BY id DESC", [], (err, filas) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(filas);
    });
});

/* El admin puede actualizar el estado de una solicitud */
app.post('/admin/solicitudes/:id/estado', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    baseDatos.run("UPDATE solicitudes_cita SET estado=? WHERE id=?", [estado, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Estado actualizado' });
    });
});

/*
RUTAS ADMIN — ADMINISTRADORES
*/
app.post('/admin/agregar', requireAdmin, (req, res) => {
    const { nombreUsuario, contrasena } = req.body;
    baseDatos.run(
        "INSERT INTO usuarios (nombreUsuario, contrasena, rol) VALUES (?, ?, 'admin')",
        [nombreUsuario, contrasena],
        (err) => {
            if (err) return res.status(500).json({ error: 'El usuario ya existe o hubo un error' });
            res.json({ mensaje: 'Administrador creado correctamente' });
        }
    );
});

app.delete('/admin/borrar/:nombreUsuario', requireAdmin, (req, res) => {
    const { nombreUsuario } = req.params;
    if (nombreUsuario === 'admin') {
        return res.status(403).json({ error: 'No puedes borrar al administrador principal' });
    }
    baseDatos.run(
        "DELETE FROM usuarios WHERE nombreUsuario=? AND rol='admin'",
        [nombreUsuario],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: 'Administrador eliminado correctamente' });
        }
    );
});

app.get('/admin/lista', requireAdmin, (req, res) => {
    baseDatos.all(
        "SELECT id, nombreUsuario FROM usuarios WHERE rol='admin'",
        [], (err, filas) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(filas);
        }
    );
});

/*
RUTAS DOCTOR
*/
app.get('/doctor/mis-pacientes', requireDoctor, (req, res) => {
    baseDatos.all(`
        SELECT u.id AS id_usuario, dp.*
        FROM datos_paciente dp
        JOIN usuarios u ON u.id = dp.id_usuario
        WHERE dp.doctor_asignado=?
    `, [req.session.usuario.nombreUsuario], (err, filas) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(filas);
    });
});

app.get('/doctor/mis-citas', requireDoctor, (req, res) => {
    baseDatos.all(`
        SELECT dp.*
        FROM datos_paciente dp
        WHERE dp.doctor_asignado=?
        AND dp.cita_medica IS NOT NULL
        AND dp.cita_medica != ''
    `, [req.session.usuario.nombreUsuario], (err, filas) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(filas);
    });
});

app.post('/doctor/crear-cita', requireDoctor, (req, res) => {
    const { id_usuario_paciente, cita_medica, diagnostico } = req.body;
    baseDatos.run(
        "UPDATE datos_paciente SET cita_medica=?, diagnostico=? WHERE id_usuario=?",
        [cita_medica, diagnostico, id_usuario_paciente],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: 'Cita creada correctamente' });
        }
    );
});

/* El doctor ve las solicitudes que le han enviado */
app.get('/doctor/solicitudes', requireDoctor, (req, res) => {
    baseDatos.all(`
        SELECT * FROM solicitudes_cita
        WHERE doctor_solicitado=?
        ORDER BY id DESC
    `, [req.session.usuario.nombreUsuario], (err, filas) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(filas);
    });
});

/*
RUTAS PACIENTE
*/
app.get('/mis-citas', requireAuth, (req, res) => {
    baseDatos.get(
        "SELECT * FROM datos_paciente WHERE id_usuario=?",
        [req.session.usuario.id],
        (err, fila) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(fila || {});
        }
    );
});

app.post('/solicitar-cita', requireAuth, (req, res) => {
    const { doctor_solicitado, fecha_solicitada, motivo } = req.body;

    /* Obtenemos el nombre real del paciente desde datos_paciente */
    baseDatos.get(
        "SELECT nombre FROM datos_paciente WHERE id_usuario=?",
        [req.session.usuario.id],
        (err, paciente) => {
            const nombrePaciente = paciente ? paciente.nombre : req.session.usuario.nombreUsuario;

            baseDatos.run(
                "INSERT INTO solicitudes_cita (id_usuario, nombre_paciente, doctor_solicitado, fecha_solicitada, motivo) VALUES (?, ?, ?, ?, ?)",
                [req.session.usuario.id, nombrePaciente, doctor_solicitado, fecha_solicitada, motivo],
                (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ mensaje: 'Solicitud enviada correctamente' });
                }
            );
        }
    );
});

app.get('/mis-solicitudes', requireAuth, (req, res) => {
    baseDatos.all(
        "SELECT * FROM solicitudes_cita WHERE id_usuario=? ORDER BY id DESC",
        [req.session.usuario.id],
        (err, filas) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(filas);
        }
    );
});

/* Lista de doctores disponibles para el paciente — no requiere auth para flexibilidad */
app.get('/doctores', (req, res) => {
    baseDatos.all(
        "SELECT dd.nombre, dd.especialidad FROM datos_doctor dd",
        [], (err, filas) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(filas);
        }
    );
});

/*
INICIAR SERVIDOR
*/
app.listen(3000, () => {
    console.log("Servidor corriendo en http://localhost:3000");
});