/* 7.1 to stereo fold (src/runtime_audio.c). */
#define _GNU_SOURCE
#include <assert.h>
#include <math.h>
#include "../src/runtime_audio.c"

uintptr_t runtime_lookup(const RuntimeExport *table, size_t count, const char *name) {
    (void)table; (void)count; (void)name;
    return 0;
}

static int near(float a, float b) { return fabsf(a-b)<1e-3f; }

/* "" clears the override. */
static void set_speakers(const char *value) {
#ifdef _WIN32
    assert(_putenv_s("ORDER1886_AUDIO_SPEAKERS",value)==0);
#else
    assert((*value ? setenv("ORDER1886_AUDIO_SPEAKERS",value,1) : unsetenv("ORDER1886_AUDIO_SPEAKERS"))==0);
#endif
}

/* One float frame in SDL order (FL FR C LFE BL BR SL SR) folded to stereo. */
static void fold_one(const float in[8], float out[2]) {
    unsigned char buf[8*4];
    memcpy(buf,in,sizeof(buf));
    assert(downmix_stereo(buf,1,1)==2*4);
    memcpy(out,buf,2*4);
}

int main(void) {
    float lr[2];
    /* Front channels pass at full level (SDL kept only ~0.21 of them). */
    fold_one((const float[8]){0.5f,0,0,0,0,0,0,0},lr); assert(near(lr[0],0.5f) && near(lr[1],0));
    fold_one((const float[8]){0,0.5f,0,0,0,0,0,0},lr); assert(near(lr[0],0) && near(lr[1],0.5f));
    /* Center and surrounds at -3 dB; LFE dropped. */
    fold_one((const float[8]){0,0,0.5f,0,0,0,0,0},lr); assert(near(lr[0],0.35355f) && near(lr[1],0.35355f));
    fold_one((const float[8]){0,0,0,1,0,0,0,0},lr); assert(near(lr[0],0) && near(lr[1],0));
    fold_one((const float[8]){0,0,0,0,0.5f,0,0.5f,0},lr); assert(near(lr[0],0.70711f) && near(lr[1],0));
    /* A loud mix is clamped instead of going past full scale. */
    fold_one((const float[8]){1,-1,1,0,1,-1,1,-1},lr); assert(lr[0]==1.0f && lr[1]==-1.0f);

    /* s16 frames, several in one buffer folded in place. */
    int16_t s[2*8]={16384,0,0,0,0,0,0,0, 32767,32767,32767,0,32767,32767,32767,32767};
    assert(downmix_stereo((unsigned char *)s,2,0)==2*2*2);
    assert(s[0]==16383 && s[1]==0);
    assert(s[2]==32767 && s[3]==32767);

    /* Speakers reported to the game (#69): the device's layout, or ORDER1886_AUDIO_SPEAKERS. */
    set_speakers("");
    assert(speakers_for(2)==2 && speakers_for(1)==2 && speakers_for(4)==2);
    assert(speakers_for(6)==6 && speakers_for(8)==8 && speakers_for(12)==8);
    set_speakers("8");
    assert(speakers_for(2)==8);
    set_speakers("2");
    assert(speakers_for(8)==2);
    set_speakers("5"); /* not a PS4 value: ignored */
    assert(speakers_for(6)==6);
    set_speakers("");
    puts("audio downmix ok");
    return 0;
}
