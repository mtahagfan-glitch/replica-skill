package local.hanu.tv;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * A tiny HTTP receiver on the home network. Hanu on the Mac sends each Arabic line here.
 *   GET  /ping?code=123456   -> {"ok":true}
 *   POST /line  (body: JSON with "code")   -> hands the JSON to the listener
 * Plain Java (no Android classes) so it can be tested on a desktop JVM.
 * Answers CORS and Private Network Access preflights, since the page runs in Chrome.
 */
public final class LineServer implements Runnable {
    public interface Listener { void onLine(String json); }

    public static final int PORT = 8787;
    private final String code;
    private final Listener listener;
    private volatile ServerSocket socket;
    private volatile boolean running = true;

    public LineServer(String code, Listener listener) { this.code = code; this.listener = listener; }

    public void start() { Thread t = new Thread(this, "hanu-line-server"); t.setDaemon(true); t.start(); }

    public void stop() { running = false; try { if (socket != null) socket.close(); } catch (IOException ignored) {} }

    @Override public void run() {
        while (running) {
            try (ServerSocket s = new ServerSocket()) {
                socket = s;
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(PORT));
                while (running) {
                    final Socket c = s.accept();
                    Thread h = new Thread(() -> handle(c), "hanu-line");
                    h.setDaemon(true); h.start();
                }
            } catch (IOException e) {
                if (!running) return;
                try { Thread.sleep(1000); } catch (InterruptedException ie) { return; }
            }
        }
    }

    private void handle(Socket c) {
        try (Socket sock = c) {
            sock.setSoTimeout(3000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            int contentLength = 0;
            for (String h; (h = readLine(in)) != null && !h.isEmpty(); ) {
                int i = h.indexOf(':');
                if (i > 0 && h.substring(0, i).trim().equalsIgnoreCase("content-length")) {
                    try { contentLength = Integer.parseInt(h.substring(i + 1).trim()); } catch (NumberFormatException ignored) {}
                }
            }
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "", path = parts.length > 1 ? parts[1] : "/";
            OutputStream out = sock.getOutputStream();
            if (method.equals("OPTIONS")) { reply(out, 204, ""); return; }
            if (method.equals("GET") && path.startsWith("/ping")) {
                boolean ok = path.contains("code=" + code);
                reply(out, ok ? 200 : 403, ok ? "{\"ok\":true,\"name\":\"hanu-tv\"}" : "{\"ok\":false,\"error\":\"code\"}");
                return;
            }
            if (method.equals("POST") && path.startsWith("/line")) {
                if (contentLength <= 0 || contentLength > 64 * 1024) { reply(out, 400, "{\"ok\":false}"); return; }
                byte[] body = new byte[contentLength];
                int off = 0;
                while (off < contentLength) { int n = in.read(body, off, contentLength - off); if (n < 0) break; off += n; }
                String json = new String(body, 0, off, StandardCharsets.UTF_8);
                if (!json.contains("\"code\":\"" + code + "\"")) { reply(out, 403, "{\"ok\":false,\"error\":\"code\"}"); return; }
                listener.onLine(json);
                reply(out, 200, "{\"ok\":true}");
                return;
            }
            reply(out, 404, "{\"ok\":false}");
        } catch (IOException ignored) {
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') break;
            if (ch != '\r') b.write(ch);
            if (b.size() > 8192) break;
        }
        if (ch == -1 && b.size() == 0) return null;
        return new String(b.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void reply(OutputStream out, int status, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 403 ? "Forbidden" : status == 400 ? "Bad Request" : "Not Found";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + b.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: content-type\r\n"
                + "Access-Control-Allow-Private-Network: true\r\n"
                + "Access-Control-Max-Age: 600\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(b);
        out.flush();
    }
}
