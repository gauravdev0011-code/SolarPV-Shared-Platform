"""Bounded streaming extrema sampling. Gapped buckets never imply continuity."""
class ExtremaSampler:
    def __init__(self, budget=2000):
        self.capacity=max(1,budget//5);self.stride=1;self.buckets={};self.count=0
    def add(self, point):
        index=self.count;self.count+=1
        key=index//self.stride
        self.buckets[key]=self.merge(self.buckets.get(key), self.bucket(point,index))
        while len(self.buckets)>self.capacity:
            merged={}
            for k,b in self.buckets.items():merged[k//2]=self.merge(merged.get(k//2),b)
            self.buckets=merged;self.stride*=2
    @staticmethod
    def bucket(p,index):
        p={**p,"_index":index}
        valid=p["value"] is not None
        return {"first":p,"last":p,"min":p if valid else None,"max":p if valid else None,"excluded":None if valid else p,"gap":not valid or p.get("break_before",False)}
    @staticmethod
    def merge(a,b):
        if a is None:return b
        lows=[p for p in (a["min"],b["min"]) if p is not None]; highs=[p for p in (a["max"],b["max"]) if p is not None]
        return {"first":a["first"],"last":b["last"],"min":min(lows,key=lambda p:p["value"]) if lows else None,"max":max(highs,key=lambda p:p["value"]) if highs else None,"excluded":a["excluded"] or b["excluded"],"gap":a["gap"] or b["gap"]}
    def points(self):
        output=[]
        for bucket in self.buckets.values():
            candidates={p["_index"]:p for p in (bucket["first"],bucket["min"],bucket["max"],bucket["excluded"],bucket["last"]) if p is not None}
            for _,p in sorted(candidates.items()):
                output.append({k:v for k,v in p.items() if k!="_index"}|{"break_before":bool(p.get("break_before") or bucket["gap"])})
        return output
