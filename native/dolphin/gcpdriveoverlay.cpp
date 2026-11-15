// Marks in Dolphin next to items of the GCP-Drive folders, like the Windows Explorer's status icons:
// only in the cloud, on this computer, kept off-line, or with changes still being sent. The service
// answers "states <folder>" on its control socket; unknown answers show no mark.

#include <KOverlayIconPlugin>

#include <QDir>
#include <QElapsedTimer>
#include <QFileInfo>
#include <QHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocalSocket>
#include <QTimer>
#include <QUrl>

class GcpDriveOverlay : public KOverlayIconPlugin
{
    Q_OBJECT
    Q_PLUGIN_METADATA(IID "org.gcpdrive.overlayiconplugin" FILE "gcpdriveoverlay.json")

public:
    GcpDriveOverlay()
    {
        m_root = QDir::homePath() + QStringLiteral("/GCP-Drive/");
        const QByteArray runtime = qgetenv("XDG_RUNTIME_DIR");
        if (!runtime.isEmpty()) {
            m_socket = QString::fromLocal8Bit(runtime) + QStringLiteral("/gcp-drive.sock");
        } else {
            QByteArray data = qgetenv("XDG_DATA_HOME");
            const QString base = data.isEmpty() ? QDir::homePath() + QStringLiteral("/.local/share") : QString::fromLocal8Bit(data);
            m_socket = base + QStringLiteral("/opengdrive/control.sock");
        }
        connect(&m_timer, &QTimer::timeout, this, &GcpDriveOverlay::follow);
        m_timer.start(3000);
    }

    QStringList getOverlays(const QUrl &item) override
    {
        if (!item.isLocalFile()) {
            return {};
        }
        const QString path = QDir::cleanPath(item.toLocalFile());
        // Items inside an account's folder: ~/GCP-Drive/<account>/<something>/...
        if (!path.startsWith(m_root) || path.mid(m_root.size()).count(QLatin1Char('/')) < 2) {
            return {};
        }
        const QFileInfo info(path);
        const QString folder = info.absolutePath();
        Folder &entry = m_folders[folder];
        if (!entry.loaded || entry.age.elapsed() > 3000) {
            load(folder, entry, false);
        }
        entry.seen.start();
        return overlays(entry.states.value(info.fileName()));
    }

private:
    struct Folder {
        QHash<QString, QString> states;
        QElapsedTimer age;
        QElapsedTimer seen;
        bool loaded = false;
    };

    static QStringList overlays(const QString &state)
    {
        if (state == QLatin1String("cloud") || state == QLatin1String("local") || state == QLatin1String("offline") || state == QLatin1String("sync")) {
            return {QStringLiteral("gcp-drive-emblem-") + state};
        }
        return {};
    }

    // load asks the service; with notify, names whose state changed are told to Dolphin.
    void load(const QString &folder, Folder &entry, bool notify)
    {
        bool ok = false;
        const QHash<QString, QString> states = query(folder, &ok);
        entry.age.start();
        if (!ok) {
            entry.loaded = true;
            return;
        }
        if (notify) {
            for (auto it = states.cbegin(); it != states.cend(); ++it) {
                if (entry.states.value(it.key()) != it.value()) {
                    Q_EMIT overlaysChanged(QUrl::fromLocalFile(folder + QLatin1Char('/') + it.key()), overlays(it.value()));
                }
            }
        }
        entry.states = states;
        entry.loaded = true;
    }

    // follow refreshes the folders Dolphin showed in the last minute and forgets the others.
    void follow()
    {
        for (auto it = m_folders.begin(); it != m_folders.end();) {
            if (!it->seen.isValid() || it->seen.elapsed() > 60000) {
                it = m_folders.erase(it);
                continue;
            }
            load(it.key(), it.value(), true);
            ++it;
        }
    }

    QHash<QString, QString> query(const QString &folder, bool *ok)
    {
        QHash<QString, QString> out;
        QLocalSocket socket;
        socket.connectToServer(m_socket);
        if (!socket.waitForConnected(200)) {
            return out;
        }
        const QJsonObject request{{QStringLiteral("Args"), QJsonArray{QStringLiteral("states"), folder}}};
        socket.write(QJsonDocument(request).toJson(QJsonDocument::Compact) + '\n');
        socket.flush();
        QByteArray data;
        QElapsedTimer waited;
        waited.start();
        while (!data.endsWith('\n') && waited.elapsed() < 500) {
            if (socket.waitForReadyRead(100)) {
                data += socket.readAll();
            } else if (socket.state() != QLocalSocket::ConnectedState) {
                data += socket.readAll();
                break;
            }
        }
        const QJsonObject reply = QJsonDocument::fromJson(data).object();
        if (reply.isEmpty() || !reply.value(QStringLiteral("Err")).toString().isEmpty()) {
            return out;
        }
        const QJsonObject states = QJsonDocument::fromJson(reply.value(QStringLiteral("Out")).toString().toUtf8()).object();
        for (auto it = states.constBegin(); it != states.constEnd(); ++it) {
            out.insert(it.key(), it.value().toString());
        }
        *ok = true;
        return out;
    }

    QString m_root;
    QString m_socket;
    QHash<QString, Folder> m_folders;
    QTimer m_timer;
};

#include "gcpdriveoverlay.moc"
