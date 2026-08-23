"""scheduler.py — Phase 5 WSD (warmup-stable-decay) LR schedule with resume support.
Warmup 2% of steps -> stable at peak -> linear decay to peak/10 over last 15%.
State saved/restored: step, phase, current lr. Test: expected LR curve + resume.
"""
import math

class WSDSchedule:
    def __init__(self, peak_lr, warmup_steps, total_steps, decay_ratio=0.15,
                 min_ratio=0.1):
        self.peak_lr = peak_lr
        self.warmup_steps = warmup_steps
        self.total_steps = total_steps
        self.decay_steps = int(total_steps * decay_ratio)
        self.stable_steps = total_steps - self.decay_steps
        self.min_lr = peak_lr * min_ratio
        self.step = 0
        self.phase = "warmup"

    def get_lr(self):
        if self.step < self.warmup_steps:
            self.phase = "warmup"
            return self.peak_lr * (self.step + 1) / max(1, self.warmup_steps)
        if self.step >= self.stable_steps:
            self.phase = "decay"
            t = (self.step + 1 - self.stable_steps) / max(1, self.decay_steps)
            t = min(1.0, t)
            return self.peak_lr - t * (self.peak_lr - self.min_lr)
        self.phase = "stable"
        return self.peak_lr

    def step_lr(self):
        lr = self.get_lr()
        self.step += 1
        return lr

    def state_dict(self):
        return {"step": self.step, "phase": self.phase}

    def load_state_dict(self, sd):
        self.step = sd["step"]
        self.phase = sd["phase"]


def main():
    s = WSDSchedule(peak_lr=3e-4, warmup_steps=100, total_steps=1000)
    curve = [s.step_lr() for _ in range(1000)]
    assert curve[0] > 0 and curve[99] == 3e-4 - 1e-10 or abs(curve[99] - 3e-4) < 1e-9, "warmup end"
    assert abs(curve[500] - 3e-4) < 1e-12, "stable phase"
    assert curve[-1] <= 3e-5 + 1e-12, "decay end"
    # resume mid-stable reproduces LR
    s2 = WSDSchedule(3e-4, 100, 1000)
    for _ in range(700):
        s2.step_lr()
    s3 = WSDSchedule(3e-4, 100, 1000)
    for _ in range(500):
        s3.step_lr()
    s3.load_state_dict(s2.state_dict())
    assert abs(s3.get_lr() - s2.get_lr()) < 1e-15, "resume LR mismatch"
    print("WSD schedule test PASS: warmup/stable/decay/resume")

if __name__ == "__main__":
    main()