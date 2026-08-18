#ifndef ELECTRON_SPOUT_SPOUT_OUTPUT_H
#define ELECTRON_SPOUT_SPOUT_OUTPUT_H

#include "SpoutDX/SpoutDX.h"
#include <d3d11_1.h>
#include <napi.h>

class SpoutOutput : public Napi::ObjectWrap<SpoutOutput> {
public:
    static void Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, Napi::Value arg);

    SpoutOutput(const Napi::CallbackInfo &info);
    ~SpoutOutput();

    Napi::Value NameGetter(const Napi::CallbackInfo &info);
    void NameSetter(const Napi::CallbackInfo &info, const Napi::Value &value);
    void UpdateFrame(const Napi::CallbackInfo &info);
    void UpdateTexture(const Napi::CallbackInfo &info);

private:
    spoutDX output = {};
    ID3D11Device* device = nullptr;
    ID3D11Device1* device1 = nullptr;
    ID3D11DeviceContext* context = nullptr;

    ID3D11Texture2D* staging = nullptr;
    ID3D11Texture2D* senderTexture = nullptr;
    int texWidth = 0;
    int texHeight = 0;
    void InitializeDevice();
    void EnsureTextures(int width, int height);
    bool SendOrThrow(ID3D11Texture2D* texture);
};


#endif
