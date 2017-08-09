#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <ESP8266HTTPUpdateServer.h>
#include <ArduinoOTA.h>
#include <ws2812_i2s.h>
#include <WebSocketsServer.h>
#include <Hash.h>
#include <FS.h>

#define NUM_LEDS    192
#define DBG_SERIAL  Serial
#define PIN_BUTTON  4
#define PIN_LED     12

static WS2812 ledstrip;

WebSocketsServer webSocket = WebSocketsServer(8080);
ESP8266WebServer server(80);
ESP8266HTTPUpdateServer httpUpdater;

const char *AP_NAME = "yuepixels";
const char *AP_PASS = "12345678";

String ver = "0.1";

int cnt = 0;
bool blinking = 0;

unsigned long previousMillis = 0;
const long interval = 1000;
int ledState = LOW;     

void buttonPressed() {
    detachInterrupt(PIN_BUTTON);
    WiFi.mode(WIFI_STA);
    DBG_SERIAL.println("\r\nSmart config start\r\n");
    WiFi.beginSmartConfig();
    blinking = 1;
}

void blinkLed(int period) {
  if (!blinking) {
    return;
  }
  
  unsigned long currentMillis = millis();
  if(currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    if (ledState == LOW)
      ledState = HIGH;  // Note that this switches the LED *off*
    else
      ledState = LOW;   // Note that this switches the LED *on*
    digitalWrite(PIN_LED, ledState);
  }
}

void handleConnectWiFi() {
    if (server.method() != HTTP_POST) {
        return;
    }

    String ssid, pass;
    for (uint8_t i = 0; i < server.args(); i++){
        if (server.argName(i) == "ssid") {
           ssid = server.arg(i); 
        } else if (server.argName(i) == "pass") {
           pass = server.arg(i);         
        }
        //message += " " + server.argName(i) + ": " + server.arg(i) + "\n";
    }

    if (ssid.length()) {
        char _ssid[32], _pass[32];
        ssid.toCharArray(_ssid, ssid.length() + 1), 
        pass.toCharArray(_pass, pass.length() + 1);
        DBG_SERIAL.printf("ssid %s pass %s\n", _ssid, _pass);
        server.send(200, "text/html", "<html><body style='width:90%;margin-left:auto;margin-right:auto;background-color:LightGray;'><h1>Restarting...You may close this window.</h1></body></html>");

        WiFi.enableSTA(false);
        delay(600);
        WiFi.begin(_ssid, _pass);
        ESP.restart();
    } 
}

void WiFiEvent(WiFiEvent_t event) {
    switch(event) {
        case WIFI_EVENT_STAMODE_GOT_IP:
            blinking = 0;
            digitalWrite(PIN_LED, HIGH);
            attachInterrupt(PIN_BUTTON, buttonPressed, FALLING);

            MDNS.begin(AP_NAME);
            MDNS.addService("http", "tcp", 80);

            DBG_SERIAL.println("WiFi connected");
            DBG_SERIAL.print("IP address: ");
            DBG_SERIAL.println(WiFi.localIP());
            break;
        case WIFI_EVENT_STAMODE_DISCONNECTED:
            DBG_SERIAL.println("WiFi lost connection");
            break;
    }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {

    switch(type) {
        case WStype_DISCONNECTED:
            DBG_SERIAL.printf("[%u] Disconnected!\n", num);
            break;
        case WStype_CONNECTED:
            {
                IPAddress ip = webSocket.remoteIP(num);
                DBG_SERIAL.printf("[%u] Connected from %d.%d.%d.%d url: %s\n", num, ip[0], ip[1], ip[2], ip[3], payload);

                // send message to client
                webSocket.sendTXT(num, "Connected");
            }
            break;
        case WStype_TEXT:
            DBG_SERIAL.printf("[%u] get Text: %s\n", num, payload);
            break;
        case WStype_BIN:
            DBG_SERIAL.printf("[%u] get binary length: %u\n", ++cnt, length);
            hexdump(payload, length);
            ledstrip.show((Pixel_t *)payload, length / 3);
            break;
    }
}

void setup() {
    DBG_SERIAL.begin(115200);
    DBG_SERIAL.print("\nYuePixles V");
    DBG_SERIAL.println(ver);

    SPIFFS.begin();
    ledstrip.init(NUM_LEDS);

    pinMode(PIN_BUTTON, INPUT_PULLUP);
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_LED, LOW);
    delay(300);
    digitalWrite(PIN_LED, HIGH);
    attachInterrupt(PIN_BUTTON, buttonPressed, FALLING);

    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_NAME, AP_PASS);
    WiFi.setAutoConnect(true);
    WiFi.onEvent(WiFiEvent);

    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
      Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
    });
    ArduinoOTA.onError([](ota_error_t error) {
      Serial.printf("Error[%u]: ", error);
      if (error == OTA_AUTH_ERROR) Serial.println("Auth Failed");
      else if (error == OTA_BEGIN_ERROR) Serial.println("Begin Failed");
      else if (error == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
      else if (error == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
      else if (error == OTA_END_ERROR) Serial.println("End Failed");
    });
    ArduinoOTA.begin();

    webSocket.begin();
    webSocket.onEvent(webSocketEvent);

    server.on("/connect.cgi", handleConnectWiFi);

    server.serveStatic("/js", SPIFFS, "/js", "max-age=8640000");
    server.serveStatic("/style", SPIFFS, "/style", "max-age=8640000");
    server.serveStatic("/index.htm", SPIFFS, "/index.htm", "max-age=8640000");
    server.serveStatic("/", SPIFFS, "/index.htm", "max-age=8640000");
    server.serveStatic("/wifi.htm", SPIFFS, "/wifi.htm", "max-age=8640000");
    server.serveStatic("/connecting.htm", SPIFFS, "/connecting.htm", "max-age=8640000");

    httpUpdater.setup(&server);
    server.begin();
}

void loop() {
    webSocket.loop();
    server.handleClient();

    ArduinoOTA.handle();
    blinkLed(300);
}

