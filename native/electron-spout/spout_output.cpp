#include "spout_output.h"
#include <d3d11_1.h>
#include <dxgi1_6.h>
#include <wrl/client.h>

void SpoutOutput::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func =
            DefineClass(env, "SpoutOutput",
                        {InstanceAccessor("name", &SpoutOutput::NameGetter, &SpoutOutput::NameSetter),
                         InstanceMethod("updateFrame", &SpoutOutput::UpdateFrame),
                         InstanceMethod("updateTexture", &SpoutOutput::UpdateTexture)});

    Napi::FunctionReference *constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("SpoutOutput", func);
}

Napi::Object SpoutOutput::NewInstance(Napi::Env env, Napi::Value arg) {
    Napi::Object obj = env.GetInstanceData<Napi::FunctionReference>()->New({arg});
    return obj;
}

SpoutOutput::SpoutOutput(const Napi::CallbackInfo &info) : ObjectWrap(info) {
    auto name = info[0].As<Napi::String>();
    InitializeDevice();

    if (device == nullptr) {
        Napi::TypeError::New(this->Env(), "device is null").ThrowAsJavaScriptException();
        return;
    }

    output.SetSenderName(name.Utf8Value().c_str());
    output.OpenDirectX11(device);
}

bool SpoutOutput::SendOrThrow(ID3D11Texture2D* texture) {
    if (!texture) {
        Napi::TypeError::New(this->Env(), "texture is null").ThrowAsJavaScriptException();
        return false;
    }
    if (!output.SendTexture(texture)) {
        Napi::TypeError::New(this->Env(), "Spout SendTexture failed").ThrowAsJavaScriptException();
        return false;
    }
    return true;
}

void SpoutOutput::UpdateFrame(const Napi::CallbackInfo &info) {
    auto buffer = info[0].As<Napi::Uint8Array>();
    auto size = info[1].As<Napi::Object>();
    auto width = size.Get("width").As<Napi::Number>().Uint32Value();
    auto height = size.Get("height").As<Napi::Number>().Uint32Value();

    EnsureTextures(width, height);
    if (!staging || !senderTexture) return;

    D3D11_MAPPED_SUBRESOURCE mapped;
    HRESULT hr = context->Map(staging, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
    if (FAILED(hr)) {
        Napi::TypeError::New(this->Env(), "Map staging texture failed").ThrowAsJavaScriptException();
        return;
    }

    auto data = buffer.Data();
    auto pitch = width * 4;
    for (UINT y = 0; y < height; ++y) {
        memcpy(static_cast<uint8_t*>(mapped.pData) + y * mapped.RowPitch, data + y * pitch, pitch);
    }
    context->Unmap(staging, 0);
    context->CopyResource(senderTexture, staging);
    SendOrThrow(senderTexture);
}

void SpoutOutput::UpdateTexture(const Napi::CallbackInfo &info) {
    auto tex = info[0].As<Napi::Object>();
    auto handleValue = tex.Get("sharedTextureHandle");
    if (!handleValue.IsBuffer()) {
        Napi::TypeError::New(this->Env(), "sharedTextureHandle is not a buffer").ThrowAsJavaScriptException();
        return;
    }

    auto buffer = handleValue.As<Napi::Buffer<uint8_t>>();
    if (buffer.Length() < sizeof(HANDLE)) {
        Napi::TypeError::New(this->Env(), "sharedTextureHandle is too small").ThrowAsJavaScriptException();
        return;
    }

    HANDLE handle = *reinterpret_cast<HANDLE*>(buffer.Data());
    Microsoft::WRL::ComPtr<ID3D11Texture2D> shared_texture;
    HRESULT hr = device1->OpenSharedResource1(handle, IID_PPV_ARGS(&shared_texture));
    if (FAILED(hr)) {
        hr = device->OpenSharedResource(handle, IID_PPV_ARGS(&shared_texture));
    }
    if (FAILED(hr) || !shared_texture) {
        Napi::TypeError::New(this->Env(), "failed to open shared texture resource").ThrowAsJavaScriptException();
        return;
    }

    SendOrThrow(shared_texture.Get());
}

Napi::Value SpoutOutput::NameGetter(const Napi::CallbackInfo &info) {
    return Napi::String::New(info.Env(), output.GetSenderName());
}

void SpoutOutput::NameSetter(const Napi::CallbackInfo &info, const Napi::Value &value) {
    auto name = value.As<Napi::String>();
    output.SetSenderName(name.Utf8Value().c_str());
}

SpoutOutput::~SpoutOutput() {
    output.ReleaseSender();
    output.CloseDirectX11();
    if (staging) staging->Release();
    if (senderTexture) senderTexture->Release();
    if (device1) device1->Release();
    if (context) context->Release();
    if (device) device->Release();
}

void SpoutOutput::EnsureTextures(int width, int height) {
    if (texWidth == width && texHeight == height && staging && senderTexture)
        return;
    texWidth = width;
    texHeight = height;

    if (staging) {
        staging->Release();
        staging = nullptr;
    }
    if (senderTexture) {
        senderTexture->Release();
        senderTexture = nullptr;
    }

    D3D11_TEXTURE2D_DESC stagingDesc = {};
    stagingDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    stagingDesc.Width = width;
    stagingDesc.Height = height;
    stagingDesc.ArraySize = 1;
    stagingDesc.MipLevels = 1;
    stagingDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    stagingDesc.Usage = D3D11_USAGE_DYNAMIC;
    stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    stagingDesc.SampleDesc.Count = 1;

    HRESULT hr = device->CreateTexture2D(&stagingDesc, nullptr, &staging);
    if (FAILED(hr)) {
        Napi::TypeError::New(this->Env(), "Create staging texture failed").ThrowAsJavaScriptException();
        return;
    }

    D3D11_TEXTURE2D_DESC senderDesc = stagingDesc;
    senderDesc.Usage = D3D11_USAGE_DEFAULT;
    senderDesc.CPUAccessFlags = 0;
    senderDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    senderDesc.MiscFlags = D3D11_RESOURCE_MISC_SHARED;

    hr = device->CreateTexture2D(&senderDesc, nullptr, &senderTexture);
    if (FAILED(hr)) {
        Napi::TypeError::New(this->Env(), "Create sender texture failed").ThrowAsJavaScriptException();
        return;
    }
}

void SpoutOutput::InitializeDevice() {
    D3D_FEATURE_LEVEL FeatureLevels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
    D3D_FEATURE_LEVEL FeatureLevel;
    UINT creationFlags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;

    Microsoft::WRL::ComPtr<IDXGIFactory2> factory2;
    HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory2));
    if (FAILED(hr)) {
        Napi::TypeError::New(this->Env(), "CreateDXGIFactory1 failed").ThrowAsJavaScriptException();
        return;
    }

    Microsoft::WRL::ComPtr<IDXGIAdapter> adapter;
    Microsoft::WRL::ComPtr<IDXGIFactory6> factory6;
    if (SUCCEEDED(factory2.As(&factory6))) {
        hr = factory6->EnumAdapterByGpuPreference(0, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE, IID_PPV_ARGS(&adapter));
    }
    if (!adapter) {
        hr = factory2->EnumAdapters(0, &adapter);
    }
    if (FAILED(hr) || !adapter) {
        Napi::TypeError::New(this->Env(), "EnumAdapters failed").ThrowAsJavaScriptException();
        return;
    }

    hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, creationFlags, FeatureLevels,
                           ARRAYSIZE(FeatureLevels), D3D11_SDK_VERSION, &device, &FeatureLevel, &context);
    if (FAILED(hr)) {
        Napi::TypeError::New(this->Env(), "D3D11CreateDevice failed").ThrowAsJavaScriptException();
        return;
    }

    hr = device->QueryInterface(IID_PPV_ARGS(&device1));
    if (FAILED(hr)) {
        Napi::TypeError::New(this->Env(), "failed to open d3d11_1 device").ThrowAsJavaScriptException();
    }
}
