const electron = require('electron');
const path = require('path');
const fitbit = require('./javascript/fitbit.js');
const client = require('./javascript/zerorpc-client');
const EventEmitter = require('events').EventEmitter
const axios = require('axios');
const api = require('./javascript/api-service')
const notification = require('./javascript/notifications')
const pythonParsing = require('./javascript/python-parsing')
const fs = require('fs');

const {
    app,
    BrowserWindow,
    ipcMain
} = electron;

let mainWinow = null;

const createWindow = () => {
    mainWinow = new BrowserWindow({
        width: 320,
        height: 390,
        resizable: false,
        icon: path.join(__dirname, 'icons/png/dark-icon-pngs/64x64.png')
    });

    mainWinow.loadURL(require('url').format({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file',
        slashes: true
    }));

    mainWinow.on('closed', () => {
        mainWinow = null
    });

    const emitter = new EventEmitter();
    client.startMeasure(emitter);
    setInterval(() => {
        client.startMeasure(emitter);
    }, 8000);

    emitter.on('measure_result', (result) => {
        let parsedResult = JSON.parse(result);

        if (parsedResult !== null && parsedResult.face_detected !== false) {
            let resultObject = parsedResult.emotions;
            resultObject.userId = 1;
            pythonParsing.ParseResults(parsedResult, (resultatos) => {
                mainWinow.webContents.send("py:status", resultatos);
            });
            // axios.post('http://167.99.38.7/emotions', resultObject)
            //     .then((res) => {

            //         pythonParsing.ParseResults(parsedResult, (resultatos) => {
            //             mainWinow.webContents.send("py:status", resultatos);
            //         });
            //     })
            //     .catch((error) => {
            //         console.log(error)
            //     });
        }
    });

    emitter.on('error', (error) => {
        mainWinow.webContents.send('py:measure_error', error);
    });
};

let settingsWindow = null;
const createSettingsWindow = () => {
    settingsWindow = new BrowserWindow({
        width: 320,
        height: 410,
        resizable: false,
        icon: path.join(__dirname, 'icons/png/dark-icon-pngs/64x64.png')
    });

    settingsWindow.loadURL(require('url').format({
        pathname: path.join(__dirname, 'settings.html'),
        protocol: 'file',
        slashes: true
    }));

    settingsWindow.on('closed', () => {
        settingsWindow = null
    });

    fs.stat('settings.json', (err) => {
        if (!err) {
            fs.unlink('settings.json');
        }
    });
};

const startup = () => {
    const measureValues = {
        posture: 1,
        fatigue: 1,
        emotions: {
            anger: 0,
            neutral: 1,
            sadness: 0,
            disgust: 0,
            happy: 0,
            surprise: 0
        }
    };

    fs.writeFile('measure.json', JSON.stringify(measureValues), (err) => {
        if (err) {
            console.log(err)
        }
    });

    fs.readFile('./credentials.json', 'utf8', (err, data) => {
        if (err) {
            createSettingsWindow();
        } else {
            let dataObject = JSON.parse(data);
            api.login(dataObject.mail, dataObject.password)
                .then(() => createWindow())
                .catch(error => console.log(error));
        }
    });
}

api.onNotification(data => {
    notification.PushNotification(data.title, data.description)
        .then(res => {
            api.responseOnNotification(data.id, res === 'yes');
        })
        .catch(error => api.responseOnNotification(data.id, false));
});

api.onAccept(data => {
    notification.pushNotificationWithoutActions(data.title, data.text);
});

api.onDecline(data => {
    notification.pushNotificationWithoutActions(data.title, data.text);
});

app.on('ready', startup);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('activate', () => {
    if (mainWinow === null) {
        initApp();
    }
});

let pyProc = null;
let pyPort = null;

const selectPort = () => {
    pyPort = 4242;
    return pyPort;
};

const pythonExec = path.join(__dirname, 'python_modules', 'env', 'bin', 'python');
const script = path.join(__dirname, 'python_modules', 'api.py')

const createPyProc = () => {
    let port = '' + selectPort()

    pyProc = require('child_process').spawn(pythonExec, [script, port]);
    if (pyPort != null) {
        console.log('child process success')
    }

    client.start();
};

const exitPyProc = () => {
    pyProc.kill();
    pyProc = null;
    pyPort = null;
};

app.on('ready', createPyProc);
app.on('will-quit', exitPyProc);

ipcMain.on('fitbit:signin', (event) => {
    fitbit.fitbitSignIn()
        .then((res) => {
            console.log(res)
        }).catch((error) => {
            console.log(error);
        })
});


ipcMain.on('settings:login', (event, creditials) => {
    api.register(creditials.mail, creditials.name, creditials.password, creditials.type)
        .then(res => {
            createWindow();
            settingsWindow.close();
            settingsWindow = null;
            fs.writeFile('credentials.json', JSON.stringify(creditials), (err) => {
                if (err) throw err;
            });
        })
        .catch(error => {
            console.log(error)
            settingsWindow.webContents.send('settings:failed', error.response.data);
        })
});

ipcMain.on('mute', (event, arg) => {
    api.changeNotificationStatus(arg);
});

ipcMain.on('start_camera', (event) => {
    client.start_camera();
    event.sender.send('camera_started');
});

ipcMain.on('capture', (event) => {
    client.capture().then(() => {
        event.sender.send('proceed_login');
    }).catch((error) => {
        console.log(error);
    });
});
